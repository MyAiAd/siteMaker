import { AITrigger, TreatmentContext, TreatmentStep } from './treatment-state-machine';
import OpenAI from 'openai';

// Create OpenAI client only when needed
function createOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export interface AIAssistanceRequest {
  trigger: AITrigger;
  userInput: string;
  context: TreatmentContext;
  currentStep: TreatmentStep;
}

export interface AIAssistanceResponse {
  message: string;
  shouldReturnToScript: boolean;
  suggestedNextStep?: string;
  tokenCount: number;
  cost: number;
}

export class AIAssistanceManager {
  private readonly MAX_TOKENS = 150; // Slightly increased for linguistic processing
  private readonly TARGET_COST_PER_SESSION = 0.05; // $0.05 per session target
  private usageStats: Map<string, SessionUsage> = new Map();

  // Define specific steps that need linguistic interpretation (body sensation check and solution state)
  private readonly AI_LINGUISTIC_STEPS = [
    'body_sensation_check',    // "Feel [contextualized emotion]... what happens in yourself when you feel [contextualized emotion]?"
    'feel_solution_state'      // "What would you feel like if '[contextualized user response]' had already happened?"
  ];

  /**
   * Process AI assistance request - Only called for specific scenarios
   */
  async processAssistanceRequest(request: AIAssistanceRequest): Promise<AIAssistanceResponse> {
    // Track usage for cost control
    this.trackUsage(request.context.sessionId);
    
    // Check if session has exceeded AI usage limits
    if (this.hasExceededLimits(request.context.sessionId)) {
      return this.getFallbackResponse(request);
    }

    // Determine if this is a linguistic processing request
    const isLinguisticProcessing = this.isLinguisticProcessingStep(request.currentStep.id);
    
    const prompt = isLinguisticProcessing 
      ? this.buildLinguisticPrompt(request)
      : this.buildMinimalPrompt(request);
    
    try {
      // Call actual OpenAI API
      const aiResponse = await this.callOpenAIService(prompt, isLinguisticProcessing);
      
      this.updateUsageStats(request.context.sessionId, aiResponse.tokenCount, aiResponse.cost);
      
      return {
        message: this.formatAIResponse(aiResponse.content, request.trigger),
        shouldReturnToScript: true,
        tokenCount: aiResponse.tokenCount,
        cost: aiResponse.cost
      };
    } catch (error) {
      console.error('AI assistance failed:', error);
      return this.getFallbackResponse(request);
    }
  }

  /**
   * Process linguistic interpretation for natural language flow
   * This gets called for the 2 specific cases where we need to avoid robotic responses:
   * 1. body_sensation_check - contextualizes emotions
   * 2. feel_solution_state - contextualizes user responses for natural flow
   */
  async processLinguisticInterpretation(
    scriptedResponse: string,
    userInput: string,
    stepId: string,
    sessionId: string
  ): Promise<{ success: boolean; improvedResponse: string; fallbackToScripted: boolean; cost: number; tokens: number }> {
    // Track usage for cost control
    this.trackUsage(sessionId);
    
    // Check if session has exceeded AI usage limits
    if (this.hasExceededLimits(sessionId)) {
      return {
        success: false,
        improvedResponse: scriptedResponse,
        fallbackToScripted: true,
        cost: 0,
        tokens: 0
      };
    }

    const prompt = this.buildLinguisticInterpretationPrompt(scriptedResponse, userInput, stepId);
    
    try {
      const aiResponse = await this.callOpenAIService(prompt, true);
      this.updateUsageStats(sessionId, aiResponse.tokenCount, aiResponse.cost);
      
      return {
        success: true,
        improvedResponse: aiResponse.content,
        fallbackToScripted: false,
        cost: aiResponse.cost,
        tokens: aiResponse.tokenCount
      };
    } catch (error) {
      console.error('Linguistic interpretation failed:', error);
      return {
        success: false,
        improvedResponse: scriptedResponse,
        fallbackToScripted: true,
        cost: 0,
        tokens: 0
      };
    }
  }

  /**
   * Check if current step requires linguistic processing
   */
  private isLinguisticProcessingStep(stepId: string): boolean {
    return this.AI_LINGUISTIC_STEPS.includes(stepId);
  }

  /**
   * Build linguistic interpretation prompt for natural language flow
   */
  private buildLinguisticPrompt(request: AIAssistanceRequest): string {
    const { userInput, context, currentStep } = request;
    const lastResponse = context.userResponses[context.currentStep] || '';
    
    // Get the template response that would normally be used
    const templateResponse = this.getTemplateResponse(currentStep.id, lastResponse);
    
    return `You are a linguistic interpreter for therapeutic Mind Shifting sessions.

Current therapeutic step: ${currentStep.id}
User's response: "${userInput}"
Template response: "${templateResponse}"

Your task is to rephrase the template response to use natural, conversational language while maintaining the exact therapeutic structure and intent.

Rules:
1. Extract the core emotional state or desired outcome from the user's response
2. Use the user's actual emotional words naturally in the rephrased response
3. Keep the same question structure and therapeutic intent
4. Make it sound conversational, not robotic or repetitive
5. Do not change the therapeutic protocol or add new content
6. Return only the rephrased response, nothing else

Examples:
- Instead of: "What would you feel like if 'I need to feel happy' had already happened"
- Say: "What would you feel like if you already felt happy?"

- Instead of: "Feel 'I would feel good'... what does 'I would feel good' feel like?"
- Say: "Feel GOOD... what does GOOD feel like?"

Rephrase the template response now:`;
  }

  /**
   * Build focused prompt for linguistic interpretation only
   */
  private buildLinguisticInterpretationPrompt(scriptedResponse: string, userInput: string, stepId: string): string {
    if (stepId === 'body_sensation_check') {
      return `You are a linguistic interpreter for Mind Shifting sessions. Your task is to contextualize the user's feeling response.

User's response: "${userInput}"
Current scripted response: "${scriptedResponse}"

Task: Extract the core emotion/feeling from the user's response and use it in the template.

Template: "Feel [contextualized emotion]... what happens in yourself when you feel [contextualized emotion]?"

Rules:
1. Extract the core emotional word from the user's response
2. Remove unnecessary words like "like I am", "I feel", "it's", etc.
3. Use only the core emotion in the template
4. Keep the exact template structure
5. Return only the rephrased response, nothing else

Examples:
- User: "like I am overwhelmed" → "Feel overwhelmed... what happens in yourself when you feel overwhelmed?"
- User: "I feel anxious" → "Feel anxious... what happens in yourself when you feel anxious?"
- User: "it's stressful" → "Feel stressed... what happens in yourself when you feel stressed?"
- User: "heavy" → "Feel heavy... what happens in yourself when you feel heavy?"

Extract the core emotion and apply the template now:`;
    } else if (stepId === 'feel_solution_state') {
      return `You are a linguistic interpreter for Mind Shifting sessions. Your task is to contextualize the user's response into a natural past-tense phrase.

User's response: "${userInput}"
Current scripted response: "${scriptedResponse}"

Task: Transform the user's response into a natural, past-tense phrase that completes "What would you feel like if...?"

Rules:
1. Convert the user's response to natural past tense
2. Make it sound conversational, not robotic
3. Keep the user's core meaning intact
4. Return ONLY the contextualized phrase (what goes in the quotes), not the full question
5. Do not include "had already happened" - that's redundant

Examples:
- User: "more money" → "you had more money"
- User: "better job" → "you had a better job"
- User: "lose weight" → "you had lost weight"
- User: "money issues need to be solved" → "your money issues were solved"
- User: "relationship" → "you were in that relationship"
- User: "be happy" → "you were happy"

Transform the user's response into a past-tense phrase now:`;
    }
    
    // Fallback for any other steps
    return `You are a linguistic interpreter for Mind Shifting sessions. Your task is to contextualize the user's response.

User's response: "${userInput}"
Current scripted response: "${scriptedResponse}"

Task: Make the response more natural and conversational while maintaining the therapeutic structure.

Rules:
1. Keep the therapeutic intent intact
2. Make it sound more conversational
3. Use the user's actual words naturally
4. Return only the rephrased response, nothing else

Rephrase now:`;
  }

  /**
   * Get template response for linguistic processing
   */
  private getTemplateResponse(stepId: string, userResponse: string): string {
    switch (stepId) {
      case 'feel_solution_state':
        return `What would you feel like if "${userResponse}" had already happened?`;
      case 'feel_good_state':
        return `Feel "${userResponse}"... what does "${userResponse}" feel like?`;
      case 'body_sensation_check':
        return `Feel "${userResponse}"... what happens in yourself when you feel "${userResponse}"?`;
      case 'deeper_feeling_inquiry':
        return `Feel "${userResponse}"... what does "${userResponse}" feel like in your body?`;
      case 'sensation_progression':
        return `Feel "${userResponse}"... what happens to "${userResponse}" when you feel "${userResponse}"?`;
      default:
        return `Feel "${userResponse}"... what does that feel like?`;
    }
  }

  /**
   * Build minimal, focused prompt for AI - strict context only
   */
  private buildMinimalPrompt(request: AIAssistanceRequest): string {
    const { trigger, userInput, context, currentStep } = request;
    
    const baseContext = `You are assisting with Mind Shifting treatment.
Current step: ${currentStep.id}
Expected response type: ${currentStep.expectedResponseType}
User said: "${userInput}"
Issue: ${trigger.condition}`;

    switch (trigger.action) {
      case 'clarify':
        return `${baseContext}

The user seems stuck or confused. Provide a brief, gentle clarification to help them understand what's being asked. Keep it under 30 words and guide them back to the treatment protocol. Do not deviate from the Mind Shifting methodology.`;

      case 'focus':
        return `${baseContext}

The user mentioned multiple problems. Help them focus on just one problem for this session. Ask them to choose the most pressing issue. Keep response under 25 words.`;

      case 'simplify':
        return `${baseContext}

The user's response was too long or complex. This is a 30-second interruption case. Use the exact Mind Shifting protocol: "I'm just going to stop you there because in order to apply a Mind Shifting method to this we need to define the problem, so please can you tell me what the problem is in a few words."`;

      case 'redirect':
        return `${baseContext}

The user went off-topic. Gently redirect them back to the current step of the treatment. Keep response under 15 words.`;

      default:
        return `${baseContext}

Provide brief guidance to help the user continue with the treatment. Keep response under 20 words.`;
    }
  }

  /**
   * Call OpenAI API with actual implementation
   */
  private async callOpenAIService(prompt: string, isLinguisticProcessing: boolean = false): Promise<{ content: string; tokenCount: number; cost: number }> {
    const openai = createOpenAIClient();
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Cost-effective model for linguistic processing
        messages: [{ role: "system", content: prompt }],
        max_tokens: isLinguisticProcessing ? 100 : this.MAX_TOKENS,
        temperature: isLinguisticProcessing ? 0.3 : 0.7, // Lower temperature for consistent linguistic processing
      });

      const content = completion.choices[0].message.content || "";
      const tokenCount = completion.usage?.total_tokens || 0;
      
      // Calculate cost based on gpt-4o-mini pricing
      const inputTokens = completion.usage?.prompt_tokens || 0;
      const outputTokens = completion.usage?.completion_tokens || 0;
      const cost = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000); // gpt-4o-mini pricing
      
      return {
        content: content.trim(),
        tokenCount,
        cost
      };
    } catch (error) {
      console.error('OpenAI API call failed:', error);
      throw error;
    }
  }

  /**
   * Format AI response to maintain treatment consistency
   */
  private formatAIResponse(aiContent: string, trigger: AITrigger): string {
    // Clean up the response and ensure it follows treatment protocols
    return aiContent.replace(/^\"|\"$/g, '').trim();
  }

  /**
   * Get fallback response when AI fails or limits exceeded
   */
  private getFallbackResponse(request: AIAssistanceRequest): AIAssistanceResponse {
    let fallbackMessage = "Please continue with the current step of the process.";
    
    // Provide contextual fallback based on step type
    if (this.isLinguisticProcessingStep(request.currentStep.id)) {
      const userResponse = request.userInput;
      fallbackMessage = this.getTemplateResponse(request.currentStep.id, userResponse);
    } else {
      // Use step-specific fallbacks for other AI triggers
      switch (request.trigger.action) {
        case 'clarify':
          fallbackMessage = "Take a moment to notice what you're feeling. What do you notice in your body?";
          break;
        case 'focus':
          fallbackMessage = "Let's focus on just one problem for now. Which issue feels most important to you?";
          break;
        case 'simplify':
          fallbackMessage = "I'm just going to stop you there because in order to apply a Mind Shifting method to this we need to define the problem, so please can you tell me what the problem is in a few words.";
          break;
        case 'redirect':
          fallbackMessage = "Let's return to the current step. What are you feeling in your body?";
          break;
      }
    }
    
    return {
      message: fallbackMessage,
      shouldReturnToScript: true,
      tokenCount: 0,
      cost: 0
    };
  }

  /**
   * Track AI usage for cost control
   */
  private trackUsage(sessionId: string): void {
    if (!this.usageStats.has(sessionId)) {
      this.usageStats.set(sessionId, {
        aiCallCount: 0,
        totalTokens: 0,
        totalCost: 0,
        sessionStart: new Date()
      });
    }
    
    const stats = this.usageStats.get(sessionId)!;
    stats.aiCallCount++;
  }

  /**
   * Check if session has exceeded AI usage limits
   */
  private hasExceededLimits(sessionId: string): boolean {
    const stats = this.usageStats.get(sessionId);
    if (!stats) return false;
    
    const sessionDuration = (new Date().getTime() - stats.sessionStart.getTime()) / 1000 / 60; // minutes
    const costPerMinute = stats.totalCost / Math.max(sessionDuration, 1);
    
    // Limit: Max 10 AI calls per session OR cost exceeding target
    return stats.aiCallCount > 10 || stats.totalCost > this.TARGET_COST_PER_SESSION;
  }

  /**
   * Update usage statistics after AI call
   */
  private updateUsageStats(sessionId: string, tokens: number, cost: number): void {
    const stats = this.usageStats.get(sessionId);
    if (stats) {
      stats.totalTokens += tokens;
      stats.totalCost += cost;
    }
  }

  /**
   * Get usage statistics for a session
   */
  getUsageStats(sessionId: string): SessionUsage | null {
    return this.usageStats.get(sessionId) || null;
  }

  /**
   * Get system-wide usage statistics
   */
  getSystemStats(): SystemStats {
    const sessions = Array.from(this.usageStats.values());
    const totalSessions = sessions.length;
    const sessionsWithAI = sessions.filter(s => s.aiCallCount > 0).length;
    
    return {
      totalSessions,
      sessionsWithAI,
      aiUsagePercentage: totalSessions > 0 ? (sessionsWithAI / totalSessions) * 100 : 0,
      avgCostPerSession: sessions.reduce((sum, s) => sum + s.totalCost, 0) / Math.max(totalSessions, 1),
      avgTokensPerSession: sessions.reduce((sum, s) => sum + s.totalTokens, 0) / Math.max(totalSessions, 1)
    };
  }
}

interface SessionUsage {
  aiCallCount: number;
  totalTokens: number;
  totalCost: number;
  sessionStart: Date;
}

interface SystemStats {
  totalSessions: number;
  sessionsWithAI: number;
  aiUsagePercentage: number;
  avgCostPerSession: number;
  avgTokensPerSession: number;
} 