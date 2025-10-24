import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users table for authentication
  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // Session tokens for authentication
  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // User's graph projects
  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    graphData: v.any(), // JSON from SemanticGraphLite.toJSON()
    isActive: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_isActive", ["userId", "isActive"]),

  // User's custom templates (per project)
  templates: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    sessionId: v.optional(v.string()),
    templateData: v.any(), // JSON template data
    updatedAt: v.number(),
  })
    .index("by_userId_and_projectId", ["userId", "projectId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_sessionId", ["projectId", "sessionId"]),

  // Session randomization profiles (per project)
  profiles: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    sessionId: v.string(),
    profileName: v.string(),
    profileData: v.any(), // JSON profile data
    isDefault: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_projectId", ["userId", "projectId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_sessionId", ["projectId", "sessionId"])
    .index("by_projectId_and_isDefault", ["projectId", "isDefault"]),
});
