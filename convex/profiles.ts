import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getUserIdFromToken } from "./auth";

/**
 * Save a session profile for a specific project
 */
export const save = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    sessionId: v.string(),
    profileName: v.string(),
    profileData: v.any(),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.id("profiles"),
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

    const isDefault = args.isDefault ?? false;

    // If this is being set as default, unset any existing defaults for this project
    if (isDefault) {
      const existingDefaults = await ctx.db
        .query("profiles")
        .withIndex("by_projectId_and_isDefault", (q) =>
          q.eq("projectId", args.projectId).eq("isDefault", true)
        )
        .collect();

      for (const profile of existingDefaults) {
        await ctx.db.patch(profile._id, { isDefault: false });
      }
    }

    const profileId = await ctx.db.insert("profiles", {
      userId,
      projectId: args.projectId,
      sessionId: args.sessionId,
      profileName: args.profileName,
      profileData: args.profileData,
      isDefault,
      updatedAt: Date.now(),
    });

    return profileId;
  },
});

/**
 * Get a specific profile by sessionId and project
 */
export const get = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    sessionId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      _creationTime: v.number(),
      userId: v.id("users"),
      projectId: v.id("projects"),
      sessionId: v.string(),
      profileName: v.string(),
      profileData: v.any(),
      isDefault: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null()
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

    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_projectId_and_sessionId", (q) =>
        q.eq("projectId", args.projectId).eq("sessionId", args.sessionId)
      )
      .collect();

    return profiles[0] ?? null;
  },
});

/**
 * Get the default profile for a project
 */
export const getDefault = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      _creationTime: v.number(),
      userId: v.id("users"),
      projectId: v.id("projects"),
      sessionId: v.string(),
      profileName: v.string(),
      profileData: v.any(),
      isDefault: v.boolean(),
      updatedAt: v.number(),
    }),
    v.null()
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

    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_projectId_and_isDefault", (q) =>
        q.eq("projectId", args.projectId).eq("isDefault", true)
      )
      .collect();

    return profiles[0] ?? null;
  },
});

/**
 * List all profiles for a specific project
 */
export const list = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.array(
    v.object({
      _id: v.id("profiles"),
      _creationTime: v.number(),
      userId: v.id("users"),
      projectId: v.id("projects"),
      sessionId: v.string(),
      profileName: v.string(),
      profileData: v.any(),
      isDefault: v.boolean(),
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

    return await ctx.db
      .query("profiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

/**
 * Update an existing profile
 */
export const update = mutation({
  args: {
    token: v.string(),
    profileId: v.id("profiles"),
    profileName: v.optional(v.string()),
    profileData: v.optional(v.any()),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const profile = await ctx.db.get(args.profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Verify ownership
    if (profile.userId !== userId) {
      throw new Error("Unauthorized: Profile belongs to another user");
    }

    // If setting as default, unset other defaults
    if (args.isDefault === true) {
      const existingDefaults = await ctx.db
        .query("profiles")
        .withIndex("by_projectId_and_isDefault", (q) =>
          q.eq("projectId", profile.projectId).eq("isDefault", true)
        )
        .collect();

      for (const p of existingDefaults) {
        if (p._id !== args.profileId) {
          await ctx.db.patch(p._id, { isDefault: false });
        }
      }
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.profileName !== undefined) updates.profileName = args.profileName;
    if (args.profileData !== undefined) updates.profileData = args.profileData;
    if (args.isDefault !== undefined) updates.isDefault = args.isDefault;

    await ctx.db.patch(args.profileId, updates);
    return null;
  },
});

/**
 * Delete a profile
 */
export const deleteProfile = mutation({
  args: {
    token: v.string(),
    profileId: v.id("profiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromToken(ctx, args.token);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const profile = await ctx.db.get(args.profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Verify ownership
    if (profile.userId !== userId) {
      throw new Error("Unauthorized: Profile belongs to another user");
    }

    await ctx.db.delete(args.profileId);
    return null;
  },
});
