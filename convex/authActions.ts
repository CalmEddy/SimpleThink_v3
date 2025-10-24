"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import crypto from "crypto";

/**
 * Sign up a new user
 */
export const signup = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.object({
    token: v.string(),
    userId: v.id("users"),
  }),
  handler: async (ctx, args): Promise<{ token: string; userId: Id<"users"> }> => {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      throw new Error("Invalid email format");
    }

    // Validate password length
    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    // Hash the password
    const passwordHash = crypto.createHash("sha256").update(args.password).digest("hex");

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");

    // Create the user
    const result = await ctx.runMutation(internal.auth.createUser, {
      email: args.email.toLowerCase(),
      passwordHash,
      token,
    });

    return result;
  },
});

/**
 * Sign in an existing user
 */
export const signin = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.object({
    token: v.string(),
    userId: v.id("users"),
  }),
  handler: async (ctx, args): Promise<{ token: string; userId: Id<"users"> }> => {
    // Hash the provided password
    const passwordHash = crypto.createHash("sha256").update(args.password).digest("hex");

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");

    // Verify credentials and create session
    const result = await ctx.runMutation(internal.auth.verifyAndCreateSession, {
      email: args.email.toLowerCase(),
      passwordHash,
      token,
    });

    return result;
  },
});

/**
 * Sign out (invalidate session)
 */
export const signout = action({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.auth.deleteSession, { token: args.token });
    return null;
  },
});
