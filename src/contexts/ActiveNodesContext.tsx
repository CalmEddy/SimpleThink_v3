import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import type { PhraseNode, WordNode, PromptNode, ResponseNode, PhraseChunk } from '../types/index.js';

export interface ContextFrame {
  topicId: string;
  topicText: string;
  sessionId: string;
  entityBindings: Record<string, { referent: string; kind?: 'person'|'place'|'thing'; aliases?: string[] }>;
  startedAt: number;
}

export interface ActiveNodesState {
  contextFrame?: ContextFrame;
}

export interface ContextualNodeSets {
  phrases: PhraseNode[];
  words: WordNode[];
  chunks: PhraseChunk[];
  patterns: string[];
  prompts: PromptNode[];
  responses: ResponseNode[];
  entities: Array<{ key: string; referent: string; kind?: 'person'|'place'|'thing'; aliases?: string[] }>;
}

export interface ActiveNodesActions {
  startTopicSession: (graph: SemanticGraphLite, topicText: string) => void;
  endCurrentSession: (graph: SemanticGraphLite) => void;
  setEntityBinding: (key: string, referent: string, kind?: 'person'|'place'|'thing', aliases?: string[]) => void;
  getContextualNodes: (graph: SemanticGraphLite) => ContextualNodeSets;
}

export interface ActiveNodesContextType extends ActiveNodesState, ActiveNodesActions {}

const ActiveNodesContext = createContext<ActiveNodesContextType | undefined>(undefined);

export const useActiveNodes = () => {
  const context = useContext(ActiveNodesContext);
  if (!context) {
    throw new Error('useActiveNodes must be used within an ActiveNodesProvider');
  }
  return context;
};

// Custom hook that provides ctx property with graph access
// Usage: const { ctx, contextFrame, startTopicSession } = useActiveNodesWithGraph(graph);
// Then access: ctx.phrases, ctx.words, ctx.chunks, ctx.patterns, ctx.prompts, ctx.responses, ctx.entities
export const useActiveNodesWithGraph = (graph: SemanticGraphLite) => {
  const activeNodes = useActiveNodes();
  const { contextFrame } = activeNodes;
  
  const ctx = useMemo(() => {
    console.log('🔄 useActiveNodesWithGraph: recalculating ctx with contextFrame:', contextFrame);
    return activeNodes.getContextualNodes(graph);
  }, [activeNodes.getContextualNodes, graph, contextFrame]);

  return {
    ...activeNodes,
    ctx
  };
};

interface ActiveNodesProviderProps {
  children: React.ReactNode;
}

export const ActiveNodesProvider: React.FC<ActiveNodesProviderProps> = ({ children }) => {
  const [contextFrame, setContextFrame] = useState<ContextFrame | undefined>(undefined);

  const startTopicSession = useCallback((graph: SemanticGraphLite, topicText: string) => {
    try {
      // Extract words and lemmas from topic text (simplified - in production, use your NLP pipeline)
      const words = topicText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
      const lemmas = words; // Simplified - in production, use proper lemmatization
      
      // Create or get topic
      const topic = graph.upsertTopic(topicText, lemmas);
      
      // Create new session
      const session = graph.openSession(topic.id);
      
      setContextFrame({
        topicId: topic.id,
        topicText: topic.text,
        sessionId: session.id,
        entityBindings: {},
        startedAt: Date.now(),
      });

      // Notify all components that templates should be refreshed for this new session
      // This ensures user templates are automatically loaded when a topic is created
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('prompter:templates-changed', { 
          detail: { sessionId: session.id } 
        }));
      }
    } catch (error) {
      console.error('Failed to start topic session:', error);
    }
  }, []);

  const endCurrentSession = useCallback((graph: SemanticGraphLite) => {
    if (contextFrame) {
      graph.endSession(contextFrame.sessionId);
      setContextFrame(undefined);
    }
  }, [contextFrame]);

  const setEntityBinding = useCallback((key: string, referent: string, kind?: 'person'|'place'|'thing', aliases?: string[]) => {
    if (contextFrame) {
      const updatedBindings = {
        ...contextFrame.entityBindings,
        [key]: { referent, kind, aliases }
      };
      setContextFrame({
        ...contextFrame,
        entityBindings: updatedBindings
      });
    }
  }, [contextFrame]);

  const getContextualNodes = useCallback((graph: SemanticGraphLite): ContextualNodeSets => {
    console.log('🔍 getContextualNodes called with contextFrame:', contextFrame);
    if (!contextFrame || !contextFrame.topicId) {
      console.log('🔍 No contextFrame or topicId, returning empty context');
      return {
        phrases: [],
        words: [],
        chunks: [],
        patterns: [],
        prompts: [],
        responses: [],
        entities: []
      };
    }

    // Get all edges to find contextual relationships
    const edges = graph.getEdges();
    console.log('🔍 Total edges:', edges.length);
    
    // Find phrases linked to current topic (session edges are not required)
    const contextualPhraseIds = new Set<string>();
    
    // Debug: show all edge types and topic-related edges
    const edgeTypes = new Set(edges.map(e => e.type));
    console.log('🔍 All edge types in graph:', Array.from(edgeTypes));
    
    const topicEdges = edges.filter(e => e.to === contextFrame.topicId || e.from === contextFrame.topicId);
    console.log('🔍 All edges involving topic', contextFrame.topicId, ':', topicEdges.map(e => ({ type: e.type, from: e.from, to: e.to })));
    
    // Debug: show the actual edge objects
    topicEdges.forEach((edge, i) => {
      console.log(`🔍 Topic edge ${i}:`, edge);
    });
    
    edges.forEach(edge => {
      if (edge.type === 'PHRASE_ABOUT_TOPIC' && 
          edge.to === contextFrame.topicId && 
          edge.from && edge.to) { // Filter out corrupted edges with undefined IDs
        console.log('🔍 Found PHRASE_ABOUT_TOPIC edge:', edge.from, '->', edge.to);
        contextualPhraseIds.add(edge.from);
      }
    });
    console.log('🔍 Found contextual phrase IDs:', Array.from(contextualPhraseIds));

    // Get contextual phrases
    const allPhrases = graph.getNodesByType('PHRASE') as PhraseNode[];
    console.log('🔍 Total phrases in graph:', allPhrases.length);
    const phrases = allPhrases.filter(phrase => contextualPhraseIds.has(phrase.id));
    console.log('🔍 Contextual phrases found:', phrases.length, phrases.map(p => p.text));
    
    // If no phrases are linked to this topic, return empty arrays (will show "New Topic" in UI)
    if (phrases.length === 0) {
      console.log('🔍 No topic-specific phrases found, returning empty context for new topic');
      return {
        phrases: [],
        words: [],
        chunks: [],
        patterns: [],
        prompts: [],
        responses: [],
        entities: []
      };
    }

    // Extract chunks from contextual phrases (ensure uniqueness by ID)
    const chunks: PhraseChunk[] = [];
    const chunkIds = new Set<string>();
    phrases.forEach(phrase => {
      phrase.chunks.forEach(chunk => {
        if (!chunkIds.has(chunk.id)) {
          chunkIds.add(chunk.id);
          chunks.push(chunk);
        }
      });
    });

    // Extract unique POS patterns from contextual phrases
    const patterns = [...new Set(phrases.map(phrase => phrase.posPattern).filter(Boolean))];

    // Find prompts linked to current topic
    const contextualPromptIds = new Set<string>();
    edges.forEach(edge => {
      if (edge.type === 'PROMPT_ABOUT_TOPIC' && edge.to === contextFrame.topicId) {
        contextualPromptIds.add(edge.from);
      }
    });
    const allPrompts = graph.getNodesByType('PROMPT') as PromptNode[];
    const prompts = allPrompts.filter(prompt => contextualPromptIds.has(prompt.id));

    // Find responses to contextual prompts
    const promptIds = new Set(prompts.map(p => p.id));
    const allResponses = graph.getNodesByType('RESPONSE') as ResponseNode[];
    const responses = allResponses.filter(response => promptIds.has(response.promptId));

    // Extract words from BOTH contextual phrases AND responses
    const wordIds = new Set<string>();
    
    // Add words from phrases
    phrases.forEach(phrase => {
      phrase.wordIds.forEach(wordId => wordIds.add(wordId));
    });
    
    // Add words from responses
    responses.forEach(response => {
      if (response.wordIds) {
        response.wordIds.forEach(wordId => wordIds.add(wordId));
      }
    });
    
    const allWords = graph.getNodesByType('WORD') as WordNode[];
    const words = allWords.filter(word => wordIds.has(word.id));

    // Convert entity bindings to array format
    const entities = Object.entries(contextFrame.entityBindings).map(([key, binding]) => ({
      key,
      ...binding
    }));

    return {
      phrases,
      words,
      chunks,
      patterns,
      prompts,
      responses,
      entities
    };
  }, [contextFrame]);

  const value: ActiveNodesContextType = {
    contextFrame,
    startTopicSession,
    endCurrentSession,
    setEntityBinding,
    getContextualNodes,
  };

  return (
    <ActiveNodesContext.Provider value={value}>
      {children}
    </ActiveNodesContext.Provider>
  );
};
