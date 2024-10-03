declare module "@nlpjs/basic" {
  export function dockStart(options: { use: string[] }): Promise<Dock>;

  export interface Dock {
    get(name: string): any;
    get(name: "nlp"): Nlp;
  }

  export interface Nlp {
    addLanguage(lang: string): void;
    addDocument(language: string, utterance: string, intent: string): void;
    removeDocument(language: string, utterance: string, intent: string): void;
    addAnswer(language: string, intent: string, answer: string): void;
    removeAnswer(language: string, intent: string, answer: string): void;
    train(): Promise<void>;
    process(language: string, utterance: string): Promise<ProcessResult>;
  }

  export interface ProcessResult {
    intent: string;
    score: number;
    answer: string;
  }
}
