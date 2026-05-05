// Shared types for the-gist. This file is .d.ts so Chrome never loads it —
// it only exists to feed types into tsc / your editor's language server.
//
// All declarations here are ambient (no top-level import/export), so the
// types are visible globally to every checked .js file in the project.

interface GistResult {
  is_clickbait: boolean;
  language: 'he' | 'en';
  title: string;
  summary: string[];
  clickbait_reason: string | null;
  /** True when the result was served from the in-session URL cache. */
  _cached?: boolean;
}

interface AnalyzePayload {
  url: string;
  title: string;
  content: string;
  /** Link text from the source page when the user right-clicked a link.
   *  Absent when the page was auto-analyzed on load. */
  anchorText?: string;
}

interface GistSettings {
  provider: 'anthropic' | 'openai';
  anthropicKey: string;
  openaiKey: string;
  anthropicModel: string;
  openaiModel: string;
  skipDomains: string[];
  /** When true, every page is auto-summarized on load. When false, the
   *  extension only acts via the right-click "gist this link" menu. */
  autoRun: boolean;
  /** Sub-option of autoRun. When true, clickbait pages get the full-page
   *  takeover. When false, a red-verdict panel instead. Ignored when
   *  autoRun is false. */
  hostileTakeover: boolean;
}

type AnalyzeMessage = { type: 'analyze'; payload: AnalyzePayload };
type OpenOptionsMessage = { type: 'open-options' };
type GistLinkStartMessage = { type: 'gist-link-start' };
type GistLinkMessage = { type: 'gist-link'; linkUrl: string; html: string };
type GistLinkErrorMessage = { type: 'gist-link-error'; linkUrl: string; error: string };
type ExtensionMessage =
  | AnalyzeMessage
  | OpenOptionsMessage
  | GistLinkStartMessage
  | GistLinkMessage
  | GistLinkErrorMessage;

interface GistHistoryEntry {
  url: string;
  title: string;
  hostname: string;
  language: 'he' | 'en';
  is_clickbait: boolean;
  summary: string[];
  clickbait_reason: string | null;
  anchorText?: string;
  timestamp: number;
}

type AnalyzeResponse =
  | { ok: true; result: GistResult }
  | { ok: false; error: string };

interface ProviderCallArgs {
  apiKey: string;
  model: string;
  userMessage: string;
}
