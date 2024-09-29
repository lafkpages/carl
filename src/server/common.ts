import { initialConfig } from "../config";
import { isInGithubCodespace } from "../utils";

export const publicUrl =
  initialConfig.publicUrl ||
  (isInGithubCodespace
    ? `https://${process.env.CODESPACE_NAME}-${initialConfig.port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : `http://localhost:${initialConfig.port}`);
