import { useState, useEffect } from 'react';
import { SemanticGraphLite } from './lib/semanticGraphLite.js';
import { persistenceManager } from './lib/persistence.js';
import IngestView from './components/IngestView.jsx';
import ExploreView from './components/ExploreView.jsx';
import PromptView from './components/PromptView.jsx';
import PrompterDevPanel from './components/PrompterDevPanel.tsx';
import AspectTester from './components/AspectTester.tsx';
import ActiveNodesTool from './components/ActiveNodesTool.tsx';
import { ActiveNodesProvider } from './contexts/ActiveNodesContext.jsx';
import { getAvailableTemplates } from './lib/promptEngine.js';
import { useActiveNodesWithGraph } from './contexts/ActiveNodesContext.js';
import { initializeTemplateStore } from './lib/templateStore/init.js';
import { analyzeText } from './lib/nlp.js';
import type { TemplateDoc } from './types/index.js';

type ViewType = 'ingest' | 'explore' | 'prompt' | 'dev' | 'aspect' | 'active-nodes';

// Wrapper component to provide template source for PrompterDevPanel
function DevPanelWrapper({ graph, onGraphUpdate, onError }: { 
  graph: SemanticGraphLite; 
  onGraphUpdate: () => void; 
  onError: (error: string) => void; 
}) {
  const { ctx, contextFrame } = useActiveNodesWithGraph(graph);
  
  // Create template source from available templates
  const templateSource = async (): Promise<TemplateDoc[]> => {
    if (!contextFrame?.sessionId) return [];
    
    try {
      const templates = getAvailableTemplates(ctx, contextFrame.sessionId);
      return templates.map(tpl => ({
        id: tpl.id,
        blocks: [{
          kind: 'text' as const,
          text: tpl.text || '',
          analysis: undefined
        }],
        createdInSessionId: contextFrame.sessionId
      }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load templates');
      return [];
    }
  };

  return (
    <PrompterDevPanel 
      source={templateSource}
      graph={graph}
    />
  );
}

function App() {
  const [graph, setGraph] = useState<SemanticGraphLite>(new SemanticGraphLite());
  const [currentView, setCurrentView] = useState<ViewType>('ingest');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize the app
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize persistence
      await persistenceManager.initialize();

      // Initialize One True Store (migrates legacy templates and sets up new storage)
      await initializeTemplateStore();

      // Initialize NLP early so it's available for all components
      await analyzeText('initialize');

      // Trigger initial template loading for any existing sessions
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('prompter:templates-changed', { 
          detail: { sessionId: '__global__' } 
        }));
      }

      // Load existing graph
      const savedGraph = await persistenceManager.loadGraph();
      if (savedGraph) {
        const newGraph = new SemanticGraphLite();
        newGraph.fromJSON(savedGraph);
        setGraph(newGraph);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize app:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize app');
      setIsLoading(false);
    }
  };

  const saveGraph = async () => {
    try {
      const graphJSON = graph.toJSON();
      await persistenceManager.saveGraph(graphJSON);
    } catch (err) {
      console.error('Failed to save graph:', err);
      setError('Failed to save graph');
    }
  };

  const clearGraph = async () => {
    try {
      await persistenceManager.clearStorage();
      setGraph(new SemanticGraphLite());
      setError(null);
    } catch (err) {
      console.error('Failed to clear graph:', err);
      setError('Failed to clear graph');
    }
  };

  const auditAllWords = async () => {
    try {
      await graph.auditAllWordsPosPotential();
      handleGraphUpdate(); // Save the updated graph
      setError(null);
    } catch (err) {
      console.error('Failed to audit words:', err);
      setError('Failed to audit words');
    }
  };

  const handleGraphUpdate = () => {
    // Auto-save when graph is updated
    saveGraph();
  };

  if (isLoading) {
    return (
      <div className="thinkcraft-container flex items-center justify-center">
        <div className="card p-8 rounded-lg shadow-lg">
          <div className="flex items-center space-x-4">
            <div className="spinner"></div>
            <span className="text-lg font-medium">Loading ThinkCraft Lite...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ActiveNodesProvider>
      <div className="thinkcraft-container min-h-screen">
        {/* Header */}
        <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-4">
                <h1 className="text-2xl font-bold text-white">ThinkCraft Lite</h1>
                <div className="text-sm text-white/80">
                  {graph.getNodeCount()} nodes, {graph.getEdgeCount()} edges
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <button
                  onClick={saveGraph}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Save
                </button>
                <button
                  onClick={auditAllWords}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                  title="Audit POS potential for all words"
                >
                  Audit Words
                </button>
                <button
                  onClick={clearGraph}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </header>

      {/* Navigation */}
      <nav className="bg-white/5 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'ingest', label: 'Ingest', description: 'Add phrases and extract chunks' },
              { id: 'explore', label: 'Explore', description: 'Find related phrases and create prompts' },
              { id: 'prompt', label: 'Prompt', description: 'Generate and respond to prompts' },
              { id: 'dev', label: 'Dev Panel', description: 'Template mutation playground' },
              { id: 'aspect', label: 'Aspect Tester', description: 'Test sub-topic disambiguation with GloVe' },
              { id: 'active-nodes', label: 'Active Nodes Tool', description: 'Configure and preview expanded active node pool' },
            ].map(({ id, label, description }) => (
              <button
                key={id}
                onClick={() => setCurrentView(id as ViewType)}
                className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                  currentView === id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-white/70 hover:text-white hover:border-white/30'
                }`}
                title={description}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/30 text-red-100 px-4 py-3 mx-4 mt-4 rounded-lg">
          <div className="flex items-center">
            <span className="status-indicator status-error"></span>
            <span className="font-medium">Error:</span>
            <span className="ml-2">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-300 hover:text-red-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="fade-in">
          {currentView === 'ingest' && (
            <IngestView 
              graph={graph} 
              onGraphUpdate={handleGraphUpdate}
              onError={setError}
            />
          )}
          {currentView === 'explore' && (
            <ExploreView 
              graph={graph} 
              onGraphUpdate={handleGraphUpdate}
              onError={setError}
            />
          )}
          {currentView === 'prompt' && (
            <PromptView 
              graph={graph} 
              onGraphUpdate={handleGraphUpdate}
              onError={setError}
            />
          )}
          {currentView === 'dev' && (
            <DevPanelWrapper 
              graph={graph} 
              onGraphUpdate={handleGraphUpdate}
              onError={setError}
            />
          )}
          {currentView === 'aspect' && (
            <AspectTester 
              graph={graph}
            />
          )}
          {currentView === 'active-nodes' && (
            <ActiveNodesTool 
              graph={graph}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white/5 backdrop-blur-sm border-t border-white/10 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-white/60 text-sm">
            <p>ThinkCraft Lite - Lean brainstorming graph with NLP-powered phrase analysis</p>
            <p className="mt-2">
              Built with React, TypeScript, winkNLP, and IndexedDB
            </p>
          </div>
        </div>
      </footer>
      </div>
    </ActiveNodesProvider>
  );
}

export default App;
