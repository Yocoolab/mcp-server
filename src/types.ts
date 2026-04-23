/**
 * Yocoolab Bridge types — element selection payloads and source mapping.
 * Defines element selection payloads and source mapping types.
 */

export interface Viewport {
  w: number;
  h: number;
}

export interface PageContext {
  url: string;
  title: string;
  viewport: Viewport;
  devicePixelRatio: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementContext {
  selector: string;
  tag: string;
  id: string;
  classList: string[];
  text: string;
  attributes: Record<string, string>;
  domPath: string[];
  boundingBox: BoundingBox;
}

export interface ComputedStyles {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  padding: string;
  margin: string;
  border: string;
  borderRadius: string;
  display: string;
  position: string;
  [key: string]: string;
}

export interface ElementStyles {
  computed: ComputedStyles;
}

export interface FrameworkHints {
  frameworkGuess: 'react' | 'vue' | 'angular' | 'svelte' | 'unknown';
  devServer: 'vite' | 'webpack' | 'next' | 'unknown';
  sourceMapUrl?: string;
}

export interface ElementSelectedPayload {
  type: 'ELEMENT_SELECTED';
  timestamp: number;
  correlationId: string;
  page: PageContext;
  element: ElementContext;
  styles: ElementStyles;
  hints: FrameworkHints;
}

export interface MappingCandidate {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  confidence: number;
  reason: string;
  matchType: 'text' | 'id' | 'className' | 'ariaLabel' | 'component' | 'selector';
}

export interface MappingResult {
  correlationId: string;
  candidates: MappingCandidate[];
}

export interface ClaudePromptContext {
  elementPayload: ElementSelectedPayload;
  candidates: MappingCandidate[];
  workspaceRoot: string;
  threadContext?: {
    threadId: string;
    repo: string;
    branch: string;
    messages: Array<{ author_name: string; content: string }>;
  };
}
