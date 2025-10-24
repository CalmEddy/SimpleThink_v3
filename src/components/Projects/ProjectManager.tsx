import { useState } from 'react';
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useAuth } from "../../hooks/useAuth";

interface ProjectManagerProps {
  onProjectSelected?: (projectId: Id<"projects">) => void;
}

export default function ProjectManager({ onProjectSelected }: ProjectManagerProps) {
  const { token } = useAuth();
  const projects = useQuery(api.projects.list, token ? { token } : "skip");
  const createProject = useMutation(api.projects.create);
  const setActiveProject = useMutation(api.projects.setActive);
  const deleteProject = useMutation(api.projects.deleteProject);

  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [error, setError] = useState('');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Not authenticated');
      return;
    }

    if (!newProjectName.trim()) {
      setError('Project name is required');
      return;
    }

    try {
      const projectId = await createProject({
        token,
        name: newProjectName.trim(),
        description: newProjectDescription.trim() || undefined,
      });

      setNewProjectName('');
      setNewProjectDescription('');
      setIsCreating(false);

      if (onProjectSelected) {
        onProjectSelected(projectId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    }
  };

  const handleSwitchProject = async (projectId: Id<"projects">) => {
    if (!token) return;

    try {
      await setActiveProject({ token, projectId });
      if (onProjectSelected) {
        onProjectSelected(projectId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch project');
    }
  };

  const handleDeleteProject = async (projectId: Id<"projects">, projectName: string) => {
    if (!token) return;

    if (!confirm(`Are you sure you want to delete "${projectName}"? This will delete all associated templates and profiles.`)) {
      return;
    }

    try {
      await deleteProject({ token, projectId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  if (!projects) {
    return <div className="p-4">Loading projects...</div>;
  }

  const activeProject = projects.find(p => p.isActive);

  return (
    <div className="p-4 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
            {activeProject && (
              <p className="text-sm text-gray-600">
                Active: <span className="font-medium">{activeProject.name}</span>
              </p>
            )}
          </div>
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
          >
            {isCreating ? 'Cancel' : '+ New Project'}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {isCreating && (
          <form onSubmit={handleCreateProject} className="mb-4 p-4 bg-gray-50 rounded-md">
            <div className="space-y-3">
              <div>
                <label htmlFor="project-name" className="block text-sm font-medium text-gray-700">
                  Project Name *
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="My Brainstorming Project"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="project-description" className="block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="project-description"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  rows={2}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Optional description..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
                >
                  Create Project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setNewProjectName('');
                    setNewProjectDescription('');
                    setError('');
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {projects.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No projects yet. Create your first project to get started!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project._id}
                className={`p-4 border rounded-lg ${
                  project.isActive
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">
                      {project.name}
                      {project.isActive && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                          Active
                        </span>
                      )}
                    </h3>
                    {project.description && (
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                        {project.description}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      Updated {new Date(project.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {!project.isActive && (
                    <button
                      onClick={() => handleSwitchProject(project._id)}
                      className="flex-1 px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700"
                    >
                      Switch to
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProject(project._id, project.name)}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
