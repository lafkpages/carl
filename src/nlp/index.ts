import { dockStart } from "@nlpjs/basic";

const dock = await dockStart({ use: ["Basic"] });

export const nlp = dock.get("nlp");
