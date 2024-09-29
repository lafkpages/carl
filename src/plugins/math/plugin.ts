import {
  areaUnder,
  derive,
  factor,
  integrate,
  simplify,
  solve,
  tangent,
  zeroes,
} from "@metadelta/core";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

export default class extends Plugin {
  id = "math";
  name = "Math";
  description = "Plugin for useful mathematical operations.";
  version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "simplify",
        description: "Simplify a mathematical expression.",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return simplify(data);
        },
      },
      {
        name: "factor",
        description: "Factorize a mathematical expression",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return factor(data);
        },
      },
      {
        name: "zeroes",
        description: "Find the zeroes of a polynomial",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return zeroes(data).toString();
        },
      },
      {
        name: "solve",
        description: "Solve a mathematical equation",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return solve(data);
        },
      },
      {
        name: "derive",
        description: "Differentiate a mathematical expression",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return derive(data);
        },
      },
      {
        name: "integrate",
        description: "Integrate a mathematical expression",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          return integrate(data);
        },
      },
      {
        name: "tangent",
        description: "Find the tangent line of a function at a given point",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          const [, expr, x] =
            data.match(/^(.+?)\s+at\s+(?:x\s*=\s*)?(-?\d+(?:\.\d+)?)$/) ?? [];

          if (!expr || !x) {
            throw new CommandError("Invalid arguments");
          }

          return tangent(expr, parseFloat(x));
        },
      },
      {
        name: "areaunder",
        description: "Find the area under a curve",
        minLevel: PermissionLevel.NONE,

        handler({ data }) {
          const [, expr, a, b] =
            data.match(
              /^(.+?)\s+from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)$/,
            ) ?? [];

          if (!expr || !a || !b) {
            throw new CommandError("Invalid arguments");
          }

          return areaUnder(expr, {
            start: parseFloat(a),
            finish: parseFloat(b),
          }).toString();
        },
      },
    ]);
  }
}
