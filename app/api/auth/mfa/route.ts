import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/database-server';
import { MFAService } from '@/services/auth/mfa.service';
import { validateSession } from '@/lib/security-middleware';
import crypto from 'crypto';

// GET /api/auth/mfa - Get MFA status
export async function GET(request: NextRequest) {
  try {
    const sessionValidation = await validateSession(request);
    if (!sessionValidation.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mfaService = MFAService.getInstance();
    const status = await mfaService.getMFAStatus();

    return NextResponse.json(status);
  } catch (error) {
    console.error('Error getting MFA status:', error);
    return NextResponse.json({ error: 'Failed to get MFA status' }, { status: 500 });
  }
}

// POST /api/auth/mfa - Handle MFA operations
export async function POST(request: NextRequest) {
  try {
    const sessionValidation = await validateSession(request);
    if (!sessionValidation.valid || !sessionValidation.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, ...params } = body;

    const mfaService = MFAService.getInstance();

    switch (action) {
      case 'setup':
        return await handleSetupMFA(params, mfaService);
      
      case 'verify_setup':
        return await handleVerifySetup(params, mfaService);
      
      case 'disable':
        return await handleDisableMFA(params, mfaService);
      
      case 'generate_backup_codes':
        return await handleGenerateBackupCodes(sessionValidation.user.id);
      
      case 'regenerate_backup_codes':
        return await handleRegenerateBackupCodes(sessionValidation.user.id);
      
      case 'get_backup_codes':
        return await handleGetBackupCodes(sessionValidation.user.id);
      
      case 'check_backup_codes':
        return await handleCheckBackupCodes(sessionValidation.user.id);
      
      case 'verify_backup_code':
        return await handleVerifyBackupCode(params, sessionValidation.user.id);

      case 'remove_backup_codes':
        return await handleRemoveBackupCodes(sessionValidation.user.id);

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error handling MFA operation:', error);
    return NextResponse.json({ error: 'Failed to process MFA operation' }, { status: 500 });
  }
}

// Handle MFA setup
async function handleSetupMFA(params: any, mfaService: MFAService) {
  try {
    const { friendlyName = 'Authenticator App' } = params;
    
    const setupData = await mfaService.setupMFA(friendlyName);
    
    return NextResponse.json({
      success: true,
      data: setupData
    });
  } catch (error) {
    console.error('Error setting up MFA:', error);
    return NextResponse.json({ 
      error: 'Failed to setup 2FA',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Handle MFA setup verification
async function handleVerifySetup(params: any, mfaService: MFAService) {
  try {
    const { factorId, code } = params;
    
    if (!factorId || !code) {
      return NextResponse.json({ 
        error: 'Missing required parameters: factorId, code' 
      }, { status: 400 });
    }

    // Validate code format
    if (!MFAService.validateTOTPCode(code)) {
      return NextResponse.json({ 
        error: 'Invalid code format. Code must be 6 digits.' 
      }, { status: 400 });
    }

    const result = await mfaService.verifyMFASetup(factorId, code);
    
    return NextResponse.json({
      success: result.success,
      error: result.error,
      factorId: result.factorId
    });
  } catch (error) {
    console.error('Error verifying MFA setup:', error);
    return NextResponse.json({ 
      error: 'Failed to verify 2FA setup' 
    }, { status: 500 });
  }
}

// Handle MFA disable
async function handleDisableMFA(params: any, mfaService: MFAService) {
  try {
    const { factorId } = params;
    
    if (!factorId) {
      return NextResponse.json({ 
        error: 'Missing required parameter: factorId' 
      }, { status: 400 });
    }

    const success = await mfaService.disableMFA(factorId);
    
    return NextResponse.json({
      success,
      message: success ? '2FA has been disabled' : 'Failed to disable 2FA'
    });
  } catch (error) {
    console.error('Error disabling MFA:', error);
    return NextResponse.json({ 
      error: 'Failed to disable 2FA' 
    }, { status: 500 });
  }
}

// Handle backup codes generation
async function handleGenerateBackupCodes(userId: string) {
  try {
    const supabase = createServerClient();
    const backupCodes: string[] = [];

    // Generate 10 backup codes
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      backupCodes.push(code);
    }

    // Store backup codes in database
    const backupCodeRecords = backupCodes.map(code => ({
      user_id: userId,
      code: crypto.createHash('sha256').update(code).digest('hex'), // Store hashed
      used: false
    }));

    const { error } = await supabase
      .from('mfa_backup_codes')
      .insert(backupCodeRecords);

    if (error) {
      console.error('Error storing backup codes:', error);
      return NextResponse.json({ 
        error: 'Failed to store backup codes' 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      backupCodes,
      message: 'Backup codes generated successfully'
    });
  } catch (error) {
    console.error('Error generating backup codes:', error);
    return NextResponse.json({ 
      error: 'Failed to generate backup codes' 
    }, { status: 500 });
  }
}

// Handle backup codes regeneration
async function handleRegenerateBackupCodes(userId: string) {
  try {
    const supabase = createServerClient();
    
    // Remove old backup codes
    await supabase
      .from('mfa_backup_codes')
      .delete()
      .eq('user_id', userId);

    // Generate new ones
    return await handleGenerateBackupCodes(userId);
  } catch (error) {
    console.error('Error regenerating backup codes:', error);
    return NextResponse.json({ 
      error: 'Failed to regenerate backup codes' 
    }, { status: 500 });
  }
}

// Handle getting backup codes status
async function handleGetBackupCodes(userId: string) {
  try {
    const supabase = createServerClient();
    const { data: codes, error } = await supabase
      .from('mfa_backup_codes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const backupCodes = codes.map((code: any) => ({
      id: code.id,
      code: '****', // Never return actual codes
      used: code.used,
      usedAt: code.used_at ? new Date(code.used_at) : undefined
    }));
    
    return NextResponse.json({
      success: true,
      backupCodes,
      totalCodes: backupCodes.length,
      unusedCodes: backupCodes.filter(code => !code.used).length
    });
  } catch (error) {
    console.error('Error getting backup codes:', error);
    return NextResponse.json({ 
      error: 'Failed to get backup codes' 
    }, { status: 500 });
  }
}

// Handle checking if user has backup codes
async function handleCheckBackupCodes(userId: string) {
  try {
    const supabase = createServerClient();
    const { count, error } = await supabase
      .from('mfa_backup_codes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('used', false);

    if (error) {
      console.error('Error checking backup codes:', error);
      return NextResponse.json({ 
        hasBackupCodes: false 
      });
    }

    return NextResponse.json({
      hasBackupCodes: (count || 0) > 0,
      count: count || 0
    });
  } catch (error) {
    console.error('Error checking backup codes:', error);
    return NextResponse.json({ 
      hasBackupCodes: false 
    });
  }
}

// Handle backup code verification
async function handleVerifyBackupCode(params: any, userId: string) {
  try {
    const { code } = params;
    
    if (!code) {
      return NextResponse.json({ 
        error: 'Missing required parameter: code' 
      }, { status: 400 });
    }

    // Validate backup code format
    if (!MFAService.validateBackupCode(code)) {
      return NextResponse.json({ 
        error: 'Invalid backup code format' 
      }, { status: 400 });
    }

    const supabase = createServerClient();
    const hashedCode = crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');

    // Find unused backup code
    const { data: backupCode, error } = await supabase
      .from('mfa_backup_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('code', hashedCode)
      .eq('used', false)
      .single();

    if (error || !backupCode) {
      return NextResponse.json({
        success: false,
        message: 'Invalid or used backup code'
      });
    }

    // Mark as used
    await supabase
      .from('mfa_backup_codes')
      .update({
        used: true,
        used_at: new Date().toISOString()
      })
      .eq('id', backupCode.id);

    return NextResponse.json({
      success: true,
      message: 'Backup code verified successfully'
    });
  } catch (error) {
    console.error('Error verifying backup code:', error);
    return NextResponse.json({ 
      error: 'Failed to verify backup code' 
    }, { status: 500 });
  }
}

// Handle removing backup codes
async function handleRemoveBackupCodes(userId: string) {
  try {
    const supabase = createServerClient();
    await supabase
      .from('mfa_backup_codes')
      .delete()
      .eq('user_id', userId);

    return NextResponse.json({
      success: true,
      message: 'Backup codes removed successfully'
    });
  } catch (error) {
    console.error('Error removing backup codes:', error);
    return NextResponse.json({ 
      error: 'Failed to remove backup codes' 
    }, { status: 500 });
  }
}

// DELETE /api/auth/mfa - Delete MFA factor
export async function DELETE(request: NextRequest) {
  try {
    const sessionValidation = await validateSession(request);
    if (!sessionValidation.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const factorId = url.searchParams.get('factorId');

    if (!factorId) {
      return NextResponse.json({ 
        error: 'Missing required parameter: factorId' 
      }, { status: 400 });
    }

    const mfaService = MFAService.getInstance();
    const success = await mfaService.disableMFA(factorId);
    
    return NextResponse.json({
      success,
      message: success ? '2FA has been disabled' : 'Failed to disable 2FA'
    });
  } catch (error) {
    console.error('Error deleting MFA factor:', error);
    return NextResponse.json({ error: 'Failed to delete MFA factor' }, { status: 500 });
  }
} 