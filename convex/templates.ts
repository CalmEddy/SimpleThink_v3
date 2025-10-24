import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getUserIdFromToken } from "./auth";

/**
 * Save a template for a specific project
 */
export const save = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    sessionId: v.optional(v.string()),
    templateData: v.any(),
  },
  returns: v.id("templates"),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Verify project ownership
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) {
      throw new Error("Unauthorized: Project not found or access denied");
    }

    const templateId = await ctx.db.insert("templates", {
      userId,
      projectId: args.projectId,
      sessionId: args.sessionId,
      templateData: args.templateData,
      updatedAt: Date.now(),
    });

    return templateId;
  },
});

/**
 * List all templates for a specific project
 */
export const list = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    sessionId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("templates"),
      _creationTime: v.number(),
      userId: v.id("users"),
      projectId: v.id("projects"),
      sessionId: v.optional(v.string()),
      templateData: v.any(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Verify project ownership
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) {
      throw new Error("Unauthorized: Project not found or access denied");
    }

    // If sessionId is provided, filter by it; otherwise return all templates for project
    if (args.sessionId) {
      return await ctx.db
        .query("templates")
        .withIndex("by_projectId_and_sessionId", (q) =>
          q.eq("projectId", args.projectId).eq("sessionId", args.sessionId)
        )
        .collect();
    } else {
      return await ctx.db
        .query("templates")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .collect();
    }
  },
});

/**
 * Update an existing template
 */
export const update = mutation({
  args: {
    token: v.string(),
    templateId: v.id("templates"),
    templateData: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    // Verify ownership
    if (template.userId !== userId) {
      throw new Error("Unauthorized: Template belongs to another user");
    }

    await ctx.db.patch(args.templateId, {
      templateData: args.templateData,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Delete a template
 */
export const deleteTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("templates"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error("Template not found");
    }

    // Verify ownership
    if (template.userId !== userId) {
      throw new Error("Unauthorized: Template belongs to another user");
    }

    await ctx.db.delete(args.templateId);
    return null;
  },
});
