'use client';

import React, { useState, useEffect } from 'react';
import { Shield, Smartphone, Key, AlertCircle, CheckCircle, Copy, RefreshCw, X, QrCode, Download } from 'lucide-react';
import { MFAService } from '@/services/auth/mfa.service';

interface TwoFactorAuthProps {
  onStatusChange?: (enabled: boolean) => void;
}

interface MFAStatus {
  isEnabled: boolean;
  factors: Array<{
    id: string;
    type: string;
    friendlyName: string;
    status: string;
    createdAt: Date;
    lastUsed?: Date;
  }>;
  hasBackupCodes: boolean;
  lastUsed?: Date;
}

interface SetupData {
  secret: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
  factorId: string;
}

export default function TwoFactorAuth({ onStatusChange }: TwoFactorAuthProps) {
  const [mfaStatus, setMFAStatus] = useState<MFAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Load MFA status on mount
  useEffect(() => {
    loadMFAStatus();
  }, []);

  const loadMFAStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/auth/mfa');
      const data = await response.json();

      if (response.ok) {
        setMFAStatus(data);
        onStatusChange?.(data.isEnabled);
      } else {
        setError(data.error || 'Failed to load 2FA status');
      }
    } catch (error) {
      console.error('Error loading MFA status:', error);
      setError('Failed to load 2FA status');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup2FA = async () => {
    try {
      setActionLoading(true);
      setError(null);
      
      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' })
      });
      
      const data = await response.json();

      if (response.ok) {
        setSetupData(data.data);
        setIsSetupMode(true);
        setSuccess('2FA setup initiated. Please scan the QR code with your authenticator app.');
      } else {
        setError(data.error || 'Failed to setup 2FA');
      }
    } catch (error) {
      console.error('Error setting up 2FA:', error);
      setError('Failed to setup 2FA');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifySetup = async () => {
    try {
      setActionLoading(true);
      setError(null);

      if (!setupData?.factorId || !verificationCode) {
        setError('Missing setup data or verification code');
        return;
      }

      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'verify_setup',
          factorId: setupData.factorId,
          code: verificationCode
        })
      });
      
      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('2FA has been successfully enabled!');
        setBackupCodes(setupData.backupCodes);
        setShowBackupCodes(true);
        setIsSetupMode(false);
        setVerificationCode('');
        await loadMFAStatus();
      } else {
        setError(data.error || 'Failed to verify 2FA setup');
      }
    } catch (error) {
      console.error('Error verifying 2FA setup:', error);
      setError('Failed to verify 2FA setup');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable2FA = async (factorId: string) => {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);

      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'disable',
          factorId
        })
      });
      
      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess('2FA has been disabled');
        await loadMFAStatus();
      } else {
        setError(data.error || 'Failed to disable 2FA');
      }
    } catch (error) {
      console.error('Error disabling 2FA:', error);
      setError('Failed to disable 2FA');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!confirm('Are you sure you want to generate new backup codes? This will invalidate all existing backup codes.')) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);

      const response = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate_backup_codes' })
      });
      
      const data = await response.json();

      if (response.ok && data.success) {
        setBackupCodes(data.backupCodes);
        setShowBackupCodes(true);
        setSuccess('New backup codes generated. Please save them securely.');
      } else {
        setError(data.error || 'Failed to regenerate backup codes');
      }
    } catch (error) {
      console.error('Error regenerating backup codes:', error);
      setError('Failed to regenerate backup codes');
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard');
  };

  const downloadBackupCodes = () => {
    const content = backupCodes.map(code => `${code}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4 flex items-center justify-between">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mr-2" />
            <span className="text-sm text-red-800 dark:text-red-200">{error}</span>
          </div>
          <button onClick={clearMessages} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4 flex items-center justify-between">
          <div className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mr-2" />
            <span className="text-sm text-green-800 dark:text-green-200">{success}</span>
          </div>
          <button onClick={clearMessages} className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Content */}
      {!isSetupMode && !showBackupCodes && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Shield className="h-6 w-6 text-indigo-600 dark:text-indigo-400 mr-3" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Two-Factor Authentication</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Add an extra layer of security to your account
                </p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              mfaStatus?.isEnabled 
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            }`}>
              {mfaStatus?.isEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          {mfaStatus?.isEnabled ? (
            <div className="space-y-4">
              {/* Active Factors */}
              <div>
                <h4 className="font-medium text-gray-900 dark:text-white mb-3">Active Authenticators</h4>
                <div className="space-y-2">
                  {mfaStatus.factors.map((factor) => (
                    <div key={factor.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex items-center">
                        <Smartphone className="h-5 w-5 text-gray-600 dark:text-gray-400 mr-3" />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{factor.friendlyName}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Added {factor.createdAt.toLocaleDateString()}
                            {factor.lastUsed && ` • Last used ${factor.lastUsed.toLocaleDateString()}`}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDisable2FA(factor.id)}
                        disabled={actionLoading}
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Backup Codes */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Backup Codes</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Use these codes if you lose access to your authenticator app
                    </p>
                  </div>
                  <button
                    onClick={handleRegenerateBackupCodes}
                    disabled={actionLoading}
                    className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>Regenerate</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="mb-4">
                <QrCode className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Two-factor authentication is not enabled. Protect your account by enabling 2FA.
                </p>
              </div>
              <button
                onClick={handleSetup2FA}
                disabled={actionLoading}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? 'Setting up...' : 'Enable 2FA'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Setup Mode */}
      {isSetupMode && setupData && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Setup Two-Factor Authentication</h3>
          
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                1. Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>
              <div className="flex justify-center p-4 bg-white rounded-lg border-2 border-gray-200 dark:border-gray-600">
                <img src={setupData.qrCodeDataUrl} alt="QR Code for 2FA setup" className="w-48 h-48" />
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                2. Enter the 6-digit code from your authenticator app
              </p>
              <div className="flex space-x-4">
                <input
                  type="text"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white text-center text-lg font-mono"
                  maxLength={6}
                />
                <button
                  onClick={handleVerifySetup}
                  disabled={actionLoading || verificationCode.length !== 6}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => {
                  setIsSetupMode(false);
                  setSetupData(null);
                  setVerificationCode('');
                }}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Codes Display */}
      {showBackupCodes && backupCodes.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Backup Codes</h3>
            <button
              onClick={() => setShowBackupCodes(false)}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4 mb-4">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2" />
              <div>
                <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                  Important: Save these backup codes securely
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  Each code can only be used once. Store them in a safe place.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {backupCodes.map((code, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <code className="font-mono text-sm text-gray-900 dark:text-white">{code}</code>
                <button
                  onClick={() => copyToClipboard(code)}
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 ml-2"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between">
            <button
              onClick={downloadBackupCodes}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Download</span>
            </button>
            <button
              onClick={() => copyToClipboard(backupCodes.join('\n'))}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Copy className="h-4 w-4" />
              <span>Copy All</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 