import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getUserIdFromToken } from "./auth";

/**
 * Create a new project for the authenticated user
 */
export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    graphData: v.optional(v.any()),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // If this is the first project, make it active
    const existingProjects = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const isActive = existingProjects.length === 0;

    // If making this project active, deactivate all others
    if (isActive) {
      for (const project of existingProjects) {
        if (project.isActive) {
          await ctx.db.patch(project._id, { isActive: false });
        }
      }
    }

    const projectId = await ctx.db.insert("projects", {
      userId,
      name: args.name,
      description: args.description,
      graphData: args.graphData ?? { nodes: [], edges: [], version: 1 },
      isActive,
      updatedAt: Date.now(),
    });

    return projectId;
  },
});

/**
 * List all projects for the authenticated user
 */
export const list = query({
  args: {
    token: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      _creationTime: v.number(),
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      isActive: v.boolean(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    // Return projects without graphData (too large for list view)
    return projects.map((p) => ({
      _id: p._id,
      _creationTime: p._creationTime,
      userId: p.userId,
      name: p.name,
      description: p.description,
      isActive: p.isActive,
      updatedAt: p.updatedAt,
    }));
  },
});

/**
 * Get a specific project by ID (includes full graphData)
 */
export const get = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.union(
    v.object({
      _id: v.id("projects"),
      _creationTime: v.number(),
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      graphData: v.any(),
      isActive: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return null;
    }

    // Verify ownership
    if (project.userId !== userId) {
      throw new Error("Unauthorized: Project belongs to another user");
    }

    return project;
  },
});

/**
 * Get the currently active project for the user
 */
export const getActive = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("projects"),
      _creationTime: v.number(),
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      graphData: v.any(),
      isActive: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const activeProjects = await ctx.db
      .query("projects")
      .withIndex("by_userId_and_isActive", (q) =>
        q.eq("userId", userId).eq("isActive", true)
      )
      .collect();

    return activeProjects[0] ?? null;
  },
});

/**
 * Update a project's metadata and/or graph data
 */
export const update = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    graphData: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify ownership
    if (project.userId !== userId) {
      throw new Error("Unauthorized: Project belongs to another user");
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.graphData !== undefined) updates.graphData = args.graphData;

    await ctx.db.patch(args.projectId, updates);
    return null;
  },
});

/**
 * Set a project as the active project (deactivates all others)
 */
export const setActive = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify ownership
    if (project.userId !== userId) {
      throw new Error("Unauthorized: Project belongs to another user");
    }

    // Deactivate all other projects for this user
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    for (const p of allProjects) {
      if (p._id === args.projectId) {
        await ctx.db.patch(p._id, { isActive: true, updatedAt: Date.now() });
      } else if (p.isActive) {
        await ctx.db.patch(p._id, { isActive: false });
      }
    }

    return null;
  },
});

/**
 * Delete a project and all associated data (templates, profiles)
 */
export const deleteProject = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify ownership
    if (project.userId !== userId) {
      throw new Error("Unauthorized: Project belongs to another user");
    }

    // Delete all templates for this project
    const templates = await ctx.db
      .query("templates")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const template of templates) {
      await ctx.db.delete(template._id);
    }

    // Delete all profiles for this project
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const profile of profiles) {
      await ctx.db.delete(profile._id);
    }

    // Delete the project itself
    await ctx.db.delete(args.projectId);

    // If this was the active project, activate another one
    if (project.isActive) {
      const remainingProjects = await ctx.db
        .query("projects")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .order("desc")
        .first();

      if (remainingProjects) {
        await ctx.db.patch(remainingProjects._id, { isActive: true });
      }
    }

    return null;
  },
});
