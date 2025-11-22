import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";

// Write your Convex functions in any file inside this directory (`convex`).
// See https://docs.convex.dev/functions for more.

// You can read data from the database via a query:
export const myQuery = query({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Query implementation.
  handler: async (ctx, args) => {
    //// Read the database as many times as you need here.
    //// See https://docs.convex.dev/database/reading-data.
    // const documents = await ctx.db.query("tableName").collect();
    // return documents;

    console.log(args.first, args.second);
    return { result: args.first, message: `Query called with: ${args.second}` };
  },
});

// You can write data to the database via a mutation:
export const myMutation = mutation({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Mutation implementation.
  handler: async (ctx, args) => {
    //// Insert or modify documents in the database here.
    //// Mutations can also read from the database like queries.
    //// See https://docs.convex.dev/database/writing-data.
    // const id = await ctx.db.insert("tableName", {a: args.first, b: args.second});

    console.log(args.first, args.second);
    // Optionally, return a value from your mutation.
    return { success: true, data: args };
  },
});

// You can fetch data from and send data to third-party APIs via an action:
export const myAction: any = action({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Action implementation.
  handler: async (ctx, args) => {
    //// Use the browser-like `fetch` API to send HTTP requests.
    //// See https://docs.convex.dev/functions/actions#calling-third-party-apis-and-using-npm-packages.
    // const response = await ctx.fetch("https://api.thirdpartyservice.com");
    // const data = await response.json();

    //// Query data by running Convex queries.
    const data = await ctx.runQuery(api.myFunctions.myQuery, {
      first: args.first,
      second: args.second,
    });
    console.log(data);

    //// Write data by running Convex mutations.
    await ctx.runMutation(api.myFunctions.myMutation, {
      first: args.first,
      second: args.second,
    });

    return { success: true, queryResult: data };
  },
});
