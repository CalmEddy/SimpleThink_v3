import React, { useState, useEffect } from 'react';
import { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import { recordResponse, promoteResponseToPhrase, rateResponse, reassembleCompleteResponse, getResponsesForPrompt as getResponsesForPromptUtil } from '../lib/respond.js';
// Use the TypeScript bridge that realizes TemplateDocs via the Composer pipeline
import { generateEphemeralPrompts } from '../lib/promptEngineBridge';
import { useActiveNodesWithGraph } from '../contexts/ActiveNodesContext.js';
import { TemplateStore } from '../lib/templateStore';
import type { PromptNode, ResponseNode, EphemeralPrompt } from '../types/index.js';
// AI imports
import { AIModelPicker } from './AI/AIModelPicker';
import { AIKeysModal } from './AI/AIKeysModal';
import { useAISettings } from '../lib/ai/AISettings';
import { AIService } from '../lib/ai/AIService';
import { aiJSONToTemplateDocs, aiTextToTemplateDocs, detectResponseFormat, realizeAIDocsToEphemeral } from '../lib/ai/AITemplateGenerator';
import { AIEphemeralStore } from '../lib/ai/AIEphemeralStore';
import { hasAPIKeys, getKeysSource, reloadAPIKeys } from '../lib/ai/apiKeys';
import { categorizeAIError, formatErrorForDisplay } from '../lib/ai/errorHandler';

// Keep UI style chips in sync with the system prompt & parser (canonical styles only)
export const STYLE_TAGS = [
  'CONFESSIONAL',
  'MOCK-LOGIC',
  'BLUNT-CHAOS',
  'SURREAL-ODDITY',
  'WRY-SCIENCE',
  'DEADPAN-WORDPLAY',
  'MANIC-RANT',
  'MOCK-COLUMNIST',
  'SARCASTIC',
  'MUNDANE-COMMENTS',
];

interface PromptViewProps {
  graph: SemanticGraphLite;
  onGraphUpdate: () => void;
  onError: (error: string) => void;
}

export default function PromptViewEnhanced({ graph, onGraphUpdate, onError }: PromptViewProps) {
  const { ctx, contextFrame } = useActiveNodesWithGraph(graph);
  const sessionId = contextFrame?.sessionId || '__global__';
  const [selectedPrompt, setSelectedPrompt] = useState<PromptNode | null>(null);
  const [selectedEphemeralPrompt, setSelectedEphemeralPrompt] = useState<EphemeralPrompt | null>(null);
  const [responseText, setResponseText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResponse, setLastResponse] = useState<ResponseNode | null>(null);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [ephemeralPrompts, setEphemeralPrompts] = useState<EphemeralPrompt[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationCount, setGenerationCount] = useState(10);
  const [userTemplates, setUserTemplates] = useState<Array<{ id: string; text: string }>>([]);

  // AI state
  const { model, suggestionCount, passphrase } = useAISettings();
  const [keysOpen, setKeysOpen] = useState(false);
  const [aiPrompts, setAIPrompts] = useState<EphemeralPrompt[]>([]);
  const [selectedAIPrompts, setSelectedAIPrompts] = useState<Set<string>>(new Set());
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [apiKeysStatus, setApiKeysStatus] = useState<{
    hasKeys: boolean;
    source: string;
  }>({ hasKeys: false, source: 'none' });

  const refreshUserTemplates = async () => {
    try {
      const list = await TemplateStore.listAll();
      setUserTemplates(list.map(t => ({ 
        id: t.id, 
        text: t.displayText 
      })));
    } catch {
      setUserTemplates([]);
    }
  };
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [templateMixRatio, setTemplateMixRatio] = useState(0.5); // 0 = all generated, 1 = all user templates
  const [usePhraseSplitting, setUsePhraseSplitting] = useState(false);

  const prompts = graph.getNodesByType('PROMPT') as PromptNode[];
  const responses = graph.getNodesByType('RESPONSE') as ResponseNode[];

  // Load user templates and AI prompts when component mounts
  useEffect(() => {
    refreshUserTemplates();
    // Load AI prompts from persistent storage
    setAIPrompts(AIEphemeralStore.list());
    
    // Check API keys status
    const checkAPIKeys = async () => {
      try {
        const hasKeys = await hasAPIKeys();
        const source = await getKeysSource();
        setApiKeysStatus({ hasKeys, source });
      } catch (error) {
        console.warn('Failed to check API keys status:', error);
      }
    };
    checkAPIKeys();
  }, [sessionId]);

  useEffect(() => {
    const onChanged = (e: any) => {
      if (!e?.detail?.sessionId || e.detail.sessionId === sessionId) refreshUserTemplates();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'OTS_TEMPLATES') refreshUserTemplates();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('prompter:templates-changed', onChanged);
      window.addEventListener('storage', onStorage);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('prompter:templates-changed', onChanged);
        window.removeEventListener('storage', onStorage);
      }
    };
  }, [sessionId]);

  // Generate new prompts when component mounts or context changes
  useEffect(() => {
    if (contextFrame?.sessionId && ctx.words.length > 0) {
      generateNewPrompts();
    }
  }, [sessionId, ctx.words.length]);

  const generateNewPrompts = async () => {
    if (!sessionId) return;
    
    try {
      setIsGenerating(true);
      
      // Use the enhanced PromptEngine through the bridge
      const newPrompts = await generateEphemeralPrompts(
        graph,
        ctx || { words: [], phrases: [], chunks: [] },
        sessionId,
        generationCount,
        undefined, // seed
        templateMixRatio // template mix ratio
      );

      setEphemeralPrompts(newPrompts);
      
      // Refresh templates list to ensure it's up to date
      refreshUserTemplates();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to generate prompts');
    } finally {
      setIsGenerating(false);
    }
  };

  // AI prompt generation
  const generateAISuggestions = async () => {
    if (!contextFrame?.topicText) {
      onError('No topic selected. Please start a topic session first.');
      return;
    }

    console.log('🚀 AI Generation: Starting with topic:', contextFrame.topicText);
    console.log('🚀 AI Generation: Using model:', model);
    console.log('🚀 AI Generation: Context has', ctx.words.length, 'words and', ctx.phrases.length, 'phrases');

    setIsGeneratingAI(true);
    setAiError(null);

    try {
      console.log('🚀 AI Generation: Building AI service...');
      const svc = await AIService.build();
      
      console.log('🚀 AI Generation: Calling generateWhimsicalJSON...');
      const raw = await svc.generateWhimsicalJSON(contextFrame.topicText, model, passphrase);
      
      console.log('🚀 AI Generation: Raw response type:', typeof raw);
      console.log('🚀 AI Generation: Raw response preview:', typeof raw === 'string' ? raw.substring(0, 200) + '...' : JSON.stringify(raw).substring(0, 200) + '...');
      
      // Detect format and route accordingly
      const format = detectResponseFormat(raw);
      console.log('🚀 AI Generation: Detected format:', format);
      
      let docs;
      if (format === 'json') {
        console.log('🚀 AI Generation: Processing as JSON...');
        docs = aiJSONToTemplateDocs(raw as any);
      } else {
        console.log('🚀 AI Generation: Processing as text...');
        docs = aiTextToTemplateDocs(raw as string, contextFrame.topicText, model);
      }
      
      console.log('🚀 AI Generation: Generated', docs.length, 'template docs');
      
      const eps = await realizeAIDocsToEphemeral(docs, ctx);
      console.log('🚀 AI Generation: Realized', eps.length, 'ephemeral prompts');

      // UX guardrail: warn if structure is missing (adjust threshold for text format)
      const minExpectedLines = format === 'text' ? 5 : 8; // Reduced thresholds for testing
      if (eps.length < minExpectedLines) {
        const message = `AI returned fewer than ${minExpectedLines} prompts (${format} format, got ${eps.length}). This might be due to empty context or template realization issues.`;
        console.warn('⚠️ AI Generation:', message);
        setAiError(message);
      } else {
        console.log('✅ AI Generation: Successfully generated', eps.length, 'prompts');
      }

      // Update AI prompts state
      setAIPrompts(prev => [...prev, ...eps]);
    } catch (error) {
      console.error('❌ AI Generation: Error occurred:', error);
      const errorInfo = categorizeAIError(error instanceof Error ? error : new Error(String(error)));
      const userMessage = formatErrorForDisplay(errorInfo);
      setAiError(userMessage);
      onError(userMessage);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Separate AI prompts from regular prompts
  const regularPrompts = ephemeralPrompts; // These are the non-AI prompts
  const aiGeneratedPrompts = aiPrompts; // These are the AI prompts

  const handlePromptSelect = (prompt: PromptNode) => {
    setSelectedPrompt(prompt);
    setSelectedEphemeralPrompt(null);
    setResponseText('');
    setLastResponse(null);
  };

  const handleEphemeralPromptSelect = (ephemeralPrompt: EphemeralPrompt) => {
    setSelectedEphemeralPrompt(ephemeralPrompt);
    setSelectedPrompt(null);
    setResponseText('');
    setLastResponse(null);
  };

  const handleTemplateSelect = (template: any) => {
    setSelectedTemplate(template);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await TemplateStore.remove(templateId);
      
      // Refresh templates list
      refreshUserTemplates();
      
      // Clear selection if deleted template was selected
      if (selectedTemplate?.id === templateId) {
        setSelectedTemplate(null);
      }
      
      // Refresh prompts to reflect template changes
      generateNewPrompts();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete template');
    }
  };

  const handleDeleteAIPrompt = (prompt: EphemeralPrompt) => {
    if (!confirm('Are you sure you want to delete this AI prompt?')) {
      return;
    }

    try {
      // Remove from persistent storage
      AIEphemeralStore.removeBySeed(prompt.randomSeed);
      
      // Remove from current state
      setAIPrompts(prev => prev.filter(p => p.randomSeed !== prompt.randomSeed));
      
      // Clear selection if deleted prompt was selected
      if (selectedEphemeralPrompt?.randomSeed === prompt.randomSeed) {
        setSelectedEphemeralPrompt(null);
        setCurrentPrompt(null);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete AI prompt');
    }
  };

  const handleAIPromptSelect = (prompt: EphemeralPrompt, checked: boolean) => {
    setSelectedAIPrompts(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(prompt.randomSeed);
      } else {
        newSet.delete(prompt.randomSeed);
      }
      return newSet;
    });
  };

  const handleDeleteSelectedAIPrompts = () => {
    if (selectedAIPrompts.size === 0) {
      onError('No prompts selected for deletion');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedAIPrompts.size} selected AI prompt(s)?`)) {
      return;
    }

    try {
      // Remove selected prompts from persistent storage
      selectedAIPrompts.forEach(seed => {
        AIEphemeralStore.removeBySeed(seed);
      });
      
      // Remove from current state
      setAIPrompts(prev => prev.filter(p => !selectedAIPrompts.has(p.randomSeed)));
      
      // Clear selection if any deleted prompt was selected
      if (selectedEphemeralPrompt && selectedAIPrompts.has(selectedEphemeralPrompt.randomSeed)) {
        setSelectedEphemeralPrompt(null);
        setCurrentPrompt(null);
      }
      
      // Clear the selection
      setSelectedAIPrompts(new Set());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to delete selected AI prompts');
    }
  };

  const handleImportJSON = async () => {
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const jsonData = JSON.parse(text);
        
        // Use existing AI processing pipeline
        const docs = aiJSONToTemplateDocs(jsonData);
        const eps = await realizeAIDocsToEphemeral(docs, ctx);
        
        // Add to AI prompts state
        setAIPrompts(prev => [...prev, ...eps]);
        
        // Show success message
        onError(`Successfully imported ${eps.length} prompts from JSON file`);
        
      } catch (error) {
        if (error instanceof SyntaxError) {
          onError('Invalid JSON file. Please check the file format.');
        } else {
          onError(error instanceof Error ? error.message : 'Failed to import JSON file');
        }
      }
    };
    
    // Trigger file dialog
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  const handleImportText = async () => {
    // Create file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md';
    input.style.display = 'none';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const textContent = await file.text();
        
        // Use text processing pipeline
        const docs = aiTextToTemplateDocs(textContent, contextFrame?.topicText || 'imported', 'imported');
        const eps = await realizeAIDocsToEphemeral(docs, ctx);
        
        // Add to AI prompts state
        setAIPrompts(prev => [...prev, ...eps]);
        
        // Show success message
        onError(`Successfully imported ${eps.length} prompts from text file`);
        
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Failed to import text file');
      }
    };
    
    // Trigger file dialog
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  const handleSubmitResponse = async () => {
    if (!responseText.trim()) {
      onError('Please enter a response');
      return;
    }

    try {
      setIsSubmitting(true);
      
      if (selectedPrompt) {
        // Responding to existing stored prompt
        const result = await recordResponse(selectedPrompt.id, responseText.trim(), graph, undefined, usePhraseSplitting);
        setLastResponse(result.responseNode);
      } else if (selectedEphemeralPrompt && contextFrame) {
        // Responding to ephemeral prompt - convert to stored prompt first
        const promptNode = graph.recordPrompt(
          selectedEphemeralPrompt.templateId,
          selectedEphemeralPrompt.text,
          selectedEphemeralPrompt.bindings.map(b => ({
            slot: b.slot.pos,
            fillerNodeId: b.nodeId || ''
          }))
        );

        // Link to topic/session
        graph.addEdge(promptNode.id, contextFrame.topicId, 'PROMPT_ABOUT_TOPIC');
        graph.addEdge(promptNode.id, sessionId, 'CREATED_IN_SESSION');

        // Record response
        const result = await recordResponse(promptNode.id, responseText.trim(), graph, undefined, usePhraseSplitting);
        setLastResponse(result.responseNode);
        
        // Remove from the appropriate list based on prompt type
        if (aiPrompts.includes(selectedEphemeralPrompt)) {
          // Remove AI prompt from persistent storage and state
          AIEphemeralStore.removeBySeed(selectedEphemeralPrompt.randomSeed);
          setAIPrompts(prev => prev.filter(p => p !== selectedEphemeralPrompt));
        } else {
          // Remove regular ephemeral prompt
          setEphemeralPrompts(prev => prev.filter(p => p !== selectedEphemeralPrompt));
        }
        
        setSelectedEphemeralPrompt(null);
      }
      
      setResponseText('');
      onGraphUpdate();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to record response');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRateResponse = (response: ResponseNode, rating: 'like' | 'skip') => {
    rateResponse(response.id, rating, graph);
    onGraphUpdate();
  };

  const handlePromoteResponse = async (response: ResponseNode) => {
    try {
      const promotedPhrase = promoteResponseToPhrase(response.id, graph);
      if (promotedPhrase) {
        setShowPromotionModal(false);
        onGraphUpdate();
        console.log('Response promoted to phrase:', promotedPhrase.text);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to promote response');
    }
  };

  const getResponsesForPrompt = (promptId: string) => {
    return getResponsesForPromptUtil(promptId, graph);
  };

  const currentPrompt = selectedPrompt || selectedEphemeralPrompt;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Prompt & Respond</h2>
        <p className="text-white/80">
          Generate prompts and record responses to build your knowledge graph
        </p>
      </div>

      {/* Generation Controls */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-800">Generate New Prompts</h3>
          <div className="flex items-center space-x-4">
            <label className="text-sm text-gray-600">
              Count:
              <input
                type="number"
                value={generationCount}
                onChange={(e) => setGenerationCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="ml-2 w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                min="1"
                max="50"
              />
            </label>
            <button
              onClick={generateNewPrompts}
              disabled={isGenerating}
              className="btn-primary px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate New'}
            </button>
          </div>
        </div>
        
        {/* Regular Generation Progress Bar */}
        {isGenerating && (
          <div className="w-full mt-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span>Generating prompts from templates...</span>
              <span>Processing {generationCount} prompts</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full animate-pulse" style={{width: '100%'}}></div>
            </div>
          </div>
        )}
        
        <div className="text-sm text-gray-600">
          Generated {ephemeralPrompts.length} prompts from your templates and context
        </div>
      </div>

      {/* AI Generation Controls */}
      <div className="card p-6 rounded-lg shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-800">AI Suggestions</h3>
          <div className="flex items-center space-x-4">
            <button
              onClick={async () => {
                await reloadAPIKeys();
                const hasKeys = await hasAPIKeys();
                const source = await getKeysSource();
                setApiKeysStatus({ hasKeys, source });
              }}
              className="px-3 py-1.5 rounded bg-blue-100 border text-sm hover:bg-blue-200"
              title="Refresh API keys status"
            >
              Refresh Keys
            </button>
            <button
              onClick={() => setKeysOpen(true)}
              className="px-3 py-1.5 rounded bg-gray-100 border text-sm hover:bg-gray-200"
            >
              AI Keys
            </button>
          </div>
        </div>
        
        <div className="space-y-4">
          <AIModelPicker className="mb-4" />
          
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {contextFrame?.topicText ? (
                <>Topic: <span className="italic">"{contextFrame.topicText}"</span></>
              ) : (
                <span className="text-orange-600">No topic selected. Start a topic session first.</span>
              )}
              {apiKeysStatus.hasKeys && (
                <div className="text-xs text-green-600 mt-1">
                  ✓ API Keys loaded from {apiKeysStatus.source}
                </div>
              )}
              {!apiKeysStatus.hasKeys && (
                <div className="text-xs text-red-600 mt-1">
                  ⚠ No API keys found. Add keys via "AI Keys" button or create keys.json file.
                </div>
              )}
            </div>
            <button
              onClick={generateAISuggestions}
              disabled={isGeneratingAI || !contextFrame?.topicText || (!apiKeysStatus.hasKeys && !model.startsWith('local:'))}
              className="btn-primary px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              title={!contextFrame?.topicText ? "Start a topic session first" : "Generate AI Suggestions (processed via the same pipeline)"}
            >
              {isGeneratingAI ? 'Generating AI...' : 'Generate AI Suggestions'}
            </button>
            {contextFrame?.topicText && ctx.words.length === 0 && ctx.phrases.length === 0 && (
              <div className="text-sm text-amber-600 mt-2">
                💡 Tip: Try ingesting some phrases first to provide better context for AI generation
              </div>
            )}
          </div>
          
          {/* AI Generation Progress Bar */}
          {isGeneratingAI && (
            <div className="w-full">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Generating AI prompts...</span>
                <span>Processing with {model}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{width: '100%'}}></div>
              </div>
            </div>
          )}
          
          {aiError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-4 w-4 text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-2">
                  <p className="font-medium">AI Service Issue</p>
                  <p className="mt-1">{aiError}</p>
                </div>
              </div>
            </div>
          )}
          
          <div className="text-sm text-gray-600">
            {aiPrompts.length} AI-generated prompts available
          </div>
        </div>
      </div>

      {/* Full Width Prompts Section */}
      <div className="space-y-4">
        {/* Two Column Layout for Prompts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* From Graph Column */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              From Graph ({regularPrompts.length})
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {regularPrompts.map((prompt, index) => (
                <div
                  key={`${prompt.templateId}-${index}`}
                  className={`prompt-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedEphemeralPrompt === prompt ? 'ring-2 ring-blue-500' : ''
                  } bg-gray-50`}
                  onClick={() => handleEphemeralPromptSelect(prompt)}
                >
                  <div className="font-medium text-gray-800">
                    {prompt.text && prompt.text.trim().length > 0
                      ? prompt.text
                      : <span className="text-gray-500 italic">[empty after realization]</span>}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Template: {prompt.templateId} • {prompt.bindings?.length || 0} bindings
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Signature: {prompt.templateSignature}
                  </div>
                </div>
              ))}
              {regularPrompts.length === 0 && !isGenerating && (
                <div className="text-center text-gray-500 py-8">
                  No graph prompts. Click "Generate New" to create some.
                </div>
              )}
            </div>
          </div>

          {/* AI Generated Column */}
          <div className="card p-6 rounded-lg shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold text-gray-800">
                  AI Generated ({aiGeneratedPrompts.length})
                </h3>
                {aiGeneratedPrompts.length > 0 && (
                  <button
                    onClick={() => {
                      if (selectedAIPrompts.size === aiGeneratedPrompts.length) {
                        // Deselect all
                        setSelectedAIPrompts(new Set());
                      } else {
                        // Select all
                        setSelectedAIPrompts(new Set(aiGeneratedPrompts.map(p => p.randomSeed)));
                      }
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                    title={selectedAIPrompts.size === aiGeneratedPrompts.length ? "Deselect all" : "Select all"}
                  >
                    {selectedAIPrompts.size === aiGeneratedPrompts.length ? "Deselect All" : "Select All"}
                  </button>
                )}
                <button
                  onClick={handleImportJSON}
                  className="text-green-600 hover:text-green-800 text-sm font-medium px-3 py-1 bg-green-50 hover:bg-green-100 rounded transition-colors"
                  title="Import JSON file as AI prompts"
                >
                  Import JSON
                </button>
                <button
                  onClick={handleImportText}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                  title="Import text file as AI prompts"
                >
                  Import Text
                </button>
              </div>
              {selectedAIPrompts.size > 0 && (
                <button
                  onClick={handleDeleteSelectedAIPrompts}
                  className="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 bg-red-50 hover:bg-red-100 rounded transition-colors"
                  title={`Delete ${selectedAIPrompts.size} selected prompt(s)`}
                >
                  Delete Selected ({selectedAIPrompts.size})
                </button>
              )}
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {aiGeneratedPrompts.map((prompt, index) => (
                <div
                  key={`${prompt.templateId}-${index}`}
                  className={`prompt-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedEphemeralPrompt === prompt ? 'ring-2 ring-blue-500' : ''
                  } bg-blue-50 border-blue-200`}
                  onClick={() => handleEphemeralPromptSelect(prompt)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedAIPrompts.has(prompt.randomSeed)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleAIPromptSelect(prompt, e.target.checked);
                      }}
                      className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-800">
                        {prompt.text && prompt.text.trim().length > 0
                          ? prompt.text
                          : <span className="text-gray-500 italic">[empty after realization]</span>}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        Template: {prompt.templateId} • {prompt.bindings?.length || 0} bindings
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Signature: {prompt.templateSignature}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        AI
                      </span>
                      <button
                        className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAIPrompt(prompt);
                        }}
                        title="Delete AI prompt"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {aiGeneratedPrompts.length === 0 && !isGeneratingAI && (
                <div className="text-center text-gray-500 py-8">
                  No AI prompts. Click "Generate AI Suggestions" to create some.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Prompts */}
        <div className="space-y-6">
          {/* Template Mix Control */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Template Mix</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  User Templates vs Generated Templates
                </label>
                <span className="text-sm text-gray-500">
                  {Math.round(templateMixRatio * 100)}% User
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={templateMixRatio}
                onChange={(e) => setTemplateMixRatio(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${templateMixRatio * 100}%, #e5e7eb ${templateMixRatio * 100}%, #e5e7eb 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>All Generated</span>
                <span>All User Templates</span>
              </div>
            </div>
          </div>

          {/* User Templates */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              User Templates ({userTemplates.length})
            </h3>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {userTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`template-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedTemplate?.id === template.id ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleTemplateSelect(template)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 text-sm">{template.text}</div>
                      {template.tags && template.tags.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          Tags: {template.tags.join(', ')}
                        </div>
                      )}
                      {template.pinned && (
                        <div className="text-xs text-blue-600 mt-1">📌 Pinned</div>
                      )}
                    </div>
                    <button
                      className="ml-2 text-red-500 hover:text-red-700 p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTemplate(template.id);
                      }}
                      title="Delete template"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              {userTemplates.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  No user templates. Create some in the Composer or Template Editor.
                </div>
              )}
            </div>
          </div>


          {/* Stored Prompts */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Stored Prompts ({prompts.length})
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`prompt-item p-3 rounded-lg cursor-pointer transition-all ${
                    selectedPrompt?.id === prompt.id ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => handlePromptSelect(prompt)}
                >
                  <div className="font-medium text-gray-800">{prompt.templateText}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Template: {prompt.templateId} • {prompt.bindings?.length || 0} bindings
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Created: {new Date(prompt.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Response Input */}
          {currentPrompt && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Respond to Prompt</h3>
              <div className="space-y-4">
                <div className="bg-yellow-50 p-3 rounded-lg">
                  <div className="font-medium text-gray-800">
                    {selectedPrompt ? selectedPrompt.templateText : selectedEphemeralPrompt?.text}
                  </div>
                  {selectedEphemeralPrompt && (
                    <div className="text-sm text-gray-600 mt-1">
                      Template: {selectedEphemeralPrompt.templateId}
                    </div>
                  )}
                </div>
                
                <div>
                  <label htmlFor="response-input" className="block text-sm font-medium text-gray-700 mb-2">
                    Your response:
                  </label>
                  <textarea
                    id="response-input"
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Enter your response here..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={4}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Phrase Splitting Toggle */}
                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={usePhraseSplitting}
                      onChange={(e) => setUsePhraseSplitting(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Split responses into phrases
                    </span>
                  </label>
                  <div className="text-xs text-gray-500">
                    {usePhraseSplitting ? 
                      'Each sentence will be stored as a separate response' : 
                      'Entire response will be stored as one unit'
                    }
                  </div>
                </div>
                
                <button
                  onClick={handleSubmitResponse}
                  disabled={isSubmitting || !responseText.trim()}
                  className="btn-primary w-full py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center space-x-2">
                      <div className="spinner"></div>
                      <span>Submitting...</span>
                    </div>
                  ) : (
                    'Submit Response'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Responses */}
        <div className="space-y-6">
          {/* Last Response */}
          {lastResponse && (
            <div className="card p-6 rounded-lg shadow-lg slide-in">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                {usePhraseSplitting ? 'Response Phrases' : 'Last Response'}
              </h3>
              <div className="space-y-3">
                {/* Show individual phrases if phrase splitting was used */}
                {usePhraseSplitting && selectedPrompt && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">Individual Phrases:</h4>
                    {getResponsesForPrompt(selectedPrompt.id).map((response, index) => (
                      <div key={response.id} className="bg-blue-50 p-3 rounded-lg">
                        <div className="font-medium text-gray-800">
                          Phrase {index + 1}: {response.text}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          POS: <code className="bg-gray-100 px-1 py-0.5 rounded">{response.posPattern}</code>
                        </div>
                      </div>
                    ))}
                    
                    {/* Show reassembled complete response */}
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-700">Complete Response:</h4>
                      <div className="bg-green-50 p-3 rounded-lg">
                        <div className="font-medium text-gray-800">
                          {reassembleCompleteResponse(selectedPrompt.id, graph)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Show single response if phrase splitting was not used */}
                {!usePhraseSplitting && (
                  <div className="bg-green-50 p-3 rounded-lg">
                    <div className="font-medium text-gray-800">{lastResponse.text}</div>
                  </div>
                )}
                
                <div className="text-sm text-gray-600">
                  POS Pattern: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{lastResponse.posPattern}</code>
                </div>
                <div className="text-sm text-gray-600">
                  Lemmas: {lastResponse.lemmas.join(', ')}
                </div>
                <div className="text-sm text-gray-600">
                  Rating: {lastResponse.rating || 'Not rated'}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleRateResponse(lastResponse, 'like')}
                    className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Like
                  </button>
                  <button
                    onClick={() => handleRateResponse(lastResponse, 'skip')}
                    className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Skip
                  </button>
                  {lastResponse.text.split(' ').length >= 2 && lastResponse.text.split(' ').length <= 10 && (
                    <button
                      onClick={() => setShowPromotionModal(true)}
                      className="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-600"
                    >
                      Promote to Phrase
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Responses for Selected Prompt */}
          {selectedPrompt && (
            <div className="card p-6 rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">
                Responses ({getResponsesForPrompt(selectedPrompt.id).length})
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {getResponsesForPrompt(selectedPrompt.id).map((response) => (
                  <div key={response.id} className="response-item p-3 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{response.text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="bg-gray-200 px-2 py-1 rounded text-xs mr-2">
                            {response.posPattern}
                          </span>
                          {response.rating && (
                            <span className={`px-2 py-1 rounded text-xs ${
                              response.rating === 'like' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {response.rating}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {new Date(response.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex space-x-1 ml-2">
                        <button
                          onClick={() => handleRateResponse(response, 'like')}
                          className="text-red-500 hover:text-red-700 text-sm"
                          title="Like"
                        >
                          ♥
                        </button>
                        <button
                          onClick={() => handleRateResponse(response, 'skip')}
                          className="text-gray-500 hover:text-gray-700 text-sm"
                          title="Skip"
                        >
                          ✗
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response Statistics */}
          <div className="card p-6 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">Total Responses</div>
                <div className="text-lg font-semibold text-blue-800">{responses.length}</div>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="text-sm text-green-600 font-medium">Liked Responses</div>
                <div className="text-lg font-semibold text-green-800">
                  {responses.filter(r => r.rating === 'like').length}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Promotion Modal */}
      {showPromotionModal && lastResponse && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Promote Response</h3>
            <p className="text-gray-600 mb-4">
              Promote "{lastResponse.text}" to a standalone phrase?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => handlePromoteResponse(lastResponse)}
                className="btn-primary px-4 py-2 rounded-lg font-medium"
              >
                Promote
              </button>
              <button
                onClick={() => setShowPromotionModal(false)}
                className="btn-secondary px-4 py-2 rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Keys Modal */}
      <AIKeysModal open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}
