import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * Get current user from session token
 */
export const getCurrentUser = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      email: v.string(),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Find the session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return null;
    }

    // Check if session is expired (just return null, can't delete in query)
    if (session.expiresAt < Date.now()) {
      return null;
    }

    // Get the user
    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      email: user.email,
      createdAt: user.createdAt,
    };
  },
});

/**
 * Internal: Create a new user
 */
export const createUser = internalMutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    token: v.string(),
  },
  returns: v.object({
    token: v.string(),
    userId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    // Create the user
    const userId = await ctx.db.insert("users", {
      email: args.email,
      passwordHash: args.passwordHash,
      createdAt: Date.now(),
    });

    // Create a session
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    await ctx.db.insert("sessions", {
      userId,
      token: args.token,
      expiresAt,
    });

    return { token: args.token, userId };
  },
});

/**
 * Internal: Verify credentials and create session
 */
export const verifyAndCreateSession = internalMutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    token: v.string(),
  },
  returns: v.object({
    token: v.string(),
    userId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    // Find the user
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      throw new Error("Invalid email or password");
    }

    // Verify password
    if (user.passwordHash !== args.passwordHash) {
      throw new Error("Invalid email or password");
    }

    // Create a session
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    await ctx.db.insert("sessions", {
      userId: user._id,
      token: args.token,
      expiresAt,
    });

    return { token: args.token, userId: user._id };
  },
});

/**
 * Internal: Delete a session
 */
export const deleteSession = internalMutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find and delete the session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return null;
  },
});

/**
 * Helper to get userId from token (for use in other functions)
 */
export const getUserIdFromToken = async (ctx: any, token: string | undefined): Promise<Id<"users"> | null> => {
  if (!token) {
    return null;
  }

  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  return session.userId;
};
