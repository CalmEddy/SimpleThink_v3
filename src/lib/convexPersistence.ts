/**
 * Convex-based persistence layer for SemanticGraphLite
 * Replaces the local IndexedDB/localStorage persistence
 */

import type { GraphJSON } from '../types/index.js';
import type { Id } from '../../convex/_generated/dataModel';

export interface ConvexPersistenceManager {
  saveGraph: (graphData: GraphJSON, projectId: Id<"projects">) => Promise<void>;
  loadGraph: (projectId: Id<"projects"> | null) => Promise<GraphJSON | null>;
  clearStorage: () => Promise<void>;
  initialize: () => Promise<void>;
}

/**
 * Creates a Convex persistence manager
 * This is a thin wrapper that delegates to Convex mutations/queries
 * The actual persistence logic is handled by the component using Convex hooks
 */
export function createConvexPersistenceManager(
  updateProject: (args: { projectId: Id<"projects">; graphData: any }) => Promise<void>,
  getProject: (args: { projectId: Id<"projects"> }) => Promise<{ graphData: any } | null>,
  getActiveProject: () => Promise<{ _id: Id<"projects">; graphData: any } | null>
): ConvexPersistenceManager {

  return {
    async initialize() {
      // Convex handles initialization automatically
      return;
    },

    async saveGraph(graphData: GraphJSON, projectId: Id<"projects">) {
      try {
        await updateProject({
          projectId,
          graphData,
        });
      } catch (error) {
        console.error('Failed to save graph to Convex:', error);
        throw error;
      }
    },

    async loadGraph(projectId: Id<"projects"> | null) {
      try {
        let project;
        if (projectId) {
          project = await getProject({ projectId });
        } else {
          project = await getActiveProject();
        }

        if (!project) {
          return null;
        }

        return project.graphData as GraphJSON;
      } catch (error) {
        console.error('Failed to load graph from Convex:', error);
        return null;
      }
    },

    async clearStorage() {
      // Clearing is handled by deleting the project in the UI
      // This is a no-op for now
      console.warn('clearStorage called - use delete project instead');
    },
  };
}

/**
 * Hook-based persistence manager for use in React components
 * This returns the functions that can be called directly from components
 */
export interface ConvexPersistenceHooks {
  saveGraph: (graphData: GraphJSON) => Promise<void>;
  loadGraph: () => Promise<GraphJSON | null>;
  isReady: boolean;
  activeProjectId: Id<"projects"> | null;
}
