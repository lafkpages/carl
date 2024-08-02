import type { Plugin } from "../plugins";

import {
  derive,
  factor,
  integrate,
  simplify,
  solve,
  zeroes,
} from "@metadelta/core";

import { PermissionLevel } from "../perms";

export default {
  id: "math",
  name: "Math",
  description: "Plugin for useful mathematical operations.",
  version: "0.0.1",

  commands: [
    {
      name: "simplify",
      description: "Simplify a mathematical expression.",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return simplify(rest);
      },
    },
    {
      name: "factor",
      description: "Factorize a mathematical expression",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return factor(rest);
      },
    },
    {
      name: "zeroes",
      description: "Find the zeroes of a polynomial",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return zeroes(rest).toString();
      },
    },
    {
      name: "solve",
      description: "Solve a mathematical equation",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return solve(rest);
      },
    },
    {
      name: "derive",
      description: "Differentiate a mathematical expression",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return derive(rest);
      },
    },
    {
      name: "integrate",
      description: "Integrate a mathematical expression",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        return integrate(rest);
      },
    },
  ],
} satisfies Plugin;
