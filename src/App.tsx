import { useState, useEffect } from 'react';
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SemanticGraphLite } from './lib/semanticGraphLite.js';
import IngestView from './components/IngestView.jsx';
import ExploreView from './components/ExploreView.jsx';
import PromptView from './components/PromptView.jsx';
import AspectTester from './components/AspectTester.tsx';
import ActiveNodesTool from './components/ActiveNodesTool.tsx';
import { ActiveNodesProvider } from './contexts/ActiveNodesContext.jsx';
import { initializeTemplateStore } from './lib/templateStore/init.js';
import { analyzeText } from './lib/nlp.js';
import TemplateLab from './components/templateLab/TemplateLab';
import AuthGate from './components/Auth/AuthGate';
import AppHeader from './components/AppHeader';
import ProjectManager from './components/Projects/ProjectManager';
import { useAuth } from './hooks/useAuth';

type ViewType = 'ingest' | 'explore' | 'prompt' | 'dev' | 'aspect' | 'active-nodes';

function AppContent() {
  const { token } = useAuth();
  const [graph, setGraph] = useState<SemanticGraphLite>(new SemanticGraphLite());
  const [currentView, setCurrentView] = useState<ViewType>('ingest');
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Safety check - should never happen due to AuthGate, but TypeScript wants it
  if (!token) {
    return null;
  }

  // Convex hooks
  const activeProject = useQuery(api.projects.getActive, { token });
  const updateProject = useMutation(api.projects.update);
  const createProject = useMutation(api.projects.create);

  // Initialize the app
  useEffect(() => {
    initializeApp();
  }, []);

  // Load graph when active project changes
  useEffect(() => {
    if (activeProject) {
      loadGraphFromProject(activeProject);
    } else if (activeProject === null && !isLoading) {
      // No active project - prompt user to create one
      setShowProjectManager(true);
    }
  }, [activeProject]);

  const initializeApp = async () => {
    try {
      setIsLoading(true);
      setError(null);

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

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize app:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize app');
      setIsLoading(false);
    }
  };

  const loadGraphFromProject = (project: { graphData: any }) => {
    try {
      const newGraph = new SemanticGraphLite();
      if (project.graphData) {
        newGraph.fromJSON(project.graphData);
      }
      setGraph(newGraph);
    } catch (err) {
      console.error('Failed to load graph from project:', err);
      setError('Failed to load project data');
    }
  };

  const saveGraph = async () => {
    if (!activeProject) {
      setError('No active project to save to');
      return;
    }

    try {
      const graphJSON = graph.toJSON();
      await updateProject({
        token,
        projectId: activeProject._id,
        graphData: graphJSON,
      });
      setError(null);
    } catch (err) {
      console.error('Failed to save graph:', err);
      setError('Failed to save graph');
    }
  };

  const clearGraph = async () => {
    if (!confirm('Are you sure you want to clear all data in this project? This cannot be undone.')) {
      return;
    }

    try {
      const emptyGraph = new SemanticGraphLite();
      setGraph(emptyGraph);
      await saveGraph();
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

  const handleProjectSelected = (projectId: Id<"projects">) => {
    setShowProjectManager(false);
    // The graph will be loaded automatically via the useEffect when activeProject changes
  };

  if (isLoading || activeProject === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading ThinkCraft Lite...</p>
        </div>
      </div>
    );
  }

  // Show project manager if no active project or user clicked manage projects
  if (showProjectManager || activeProject === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader />
        <ProjectManager onProjectSelected={handleProjectSelected} />
        {activeProject !== null && (
          <div className="max-w-7xl mx-auto px-4 py-4">
            <button
              onClick={() => setShowProjectManager(false)}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              ← Back to {activeProject.name}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <ActiveNodesProvider>
      <div className="min-h-screen bg-gray-900">
        <AppHeader />

        {/* Project Info Bar */}
        <div className="bg-white/10 backdrop-blur-md border-b border-white/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-3">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setShowProjectManager(true)}
                  className="text-sm text-white/80 hover:text-white underline"
                >
                  Project: {activeProject.name}
                </button>
                <div className="text-sm text-white/60">
                  {graph.getNodeCount()} nodes, {graph.getEdgeCount()} edges
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={saveGraph}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-sm font-medium"
                >
                  Save
                </button>
                <button
                  onClick={auditAllWords}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-sm font-medium"
                  title="Audit POS potential for all words"
                >
                  Audit Words
                </button>
                <button
                  onClick={clearGraph}
                  className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded text-sm font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="bg-white/5 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8">
              {[
                { id: 'ingest', label: 'Ingest', description: 'Add phrases and extract chunks' },
                { id: 'explore', label: 'Explore', description: 'Find related phrases and create prompts' },
                { id: 'prompt', label: 'Prompt', description: 'Generate and respond to prompts' },
                { id: 'dev', label: 'Template Lab', description: 'Unified template workspace' },
                { id: 'aspect', label: 'Aspect Tester', description: 'Test sub-topic disambiguation with GloVe' },
                { id: 'active-nodes', label: 'Active Nodes Tool', description: 'Configure and preview expanded active node pool' },
              ].map(({ id, label, description }) => (
                <button
                  key={id}
                  onClick={() => setCurrentView(id as ViewType)}
                  className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                    currentView === id
                      ? 'border-blue-500 text-blue-400'
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
            <div className="bg-red-500/20 border border-red-500/30 text-red-100 px-4 py-3 rounded-lg flex items-center">
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
              <TemplateLab graph={graph} />
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
                Built with React, TypeScript, winkNLP, and Convex
              </p>
            </div>
          </div>
        </footer>
      </div>
    </ActiveNodesProvider>
  );
}

function App() {
  return (
    <AuthGate>
      <AppContent />
    </AuthGate>
  );
}

export default App;
