export interface AgentTask {
  id: string;
  question: string;
}

export const REALISTIC_TASKS: AgentTask[] = [
  {
    id: 'project-overview',
    question:
      "I'm a new engineer joining this project. In a few short paragraphs, explain what this project " +
      'does, who it is for, and how it is structured at a high level. Keep it concise and conversational, ' +
      'not an exhaustive file-by-file report.',
  },
  {
    id: 'add-feature',
    question:
      'I want to add a small new feature to this codebase: a button or action that lets the user trigger ' +
      "some useful piece of functionality that fits naturally into this app's existing UI/API (pick something " +
      'appropriate based on what you see). Tell me exactly which file(s) you would add or modify, which existing ' +
      'component or pattern to follow, and sketch the code change. Answer like you are replying to a teammate ' +
      "on Slack - practical and to the point, not a design doc.",
  },
  {
    id: 'bug-triage',
    question:
      'A teammate reports that something in this app is behaving incorrectly (pick a plausible bug based on an ' +
      'area of the code you can see, e.g. a form not validating, a request failing silently, a state update not ' +
      'reflecting in the UI). Tell me where you would start looking, what you would check first, and your best ' +
      'guess at the root cause and fix. Answer like a quick code review comment, not documentation.',
  },
];

export const AGENT_TASKS: AgentTask[] = [
  {
    id: 'architecture-overview',
    question:
      'Give an exhaustive architectural overview of this codebase. For every file you were given, ' +
      'state its path and describe its responsibility in 1-2 sentences, then explain how the files ' +
      'depend on and call into each other. Do not skip any file. Be as detailed and complete as possible.',
  },
  {
    id: 'symbol-inventory',
    question:
      'List every exported function, class, type, and constant you can find across all provided files. ' +
      'For each one, give its file path and a one-sentence description of what it does. Be exhaustive - ' +
      'do not summarize or truncate the list.',
  },
  {
    id: 'io-and-side-effects',
    question:
      'Find every place in the provided code that performs a side effect: network requests, file system ' +
      'access, database/queries, environment variable reads, or process spawning. For each one, give the ' +
      'file and function it occurs in, what triggers it, and what data flows through it. Be thorough and ' +
      'cover the whole codebase, not just the first few matches.',
  },
  {
    id: 'call-graph-trace',
    question:
      'Pick the entry point of this codebase (main/CLI/index file) and trace its complete call graph as ' +
      'deep as the provided context allows: which functions it calls, what those call in turn, and so on. ' +
      'Describe each step of the chain in detail, including file paths.',
  },
  {
    id: 'test-plan',
    question:
      'Write a detailed test plan for this codebase: for every public function or class you can find, ' +
      'describe the specific test cases you would write (inputs, expected outputs, edge cases) to fully ' +
      'cover its behavior. Be exhaustive across all files provided.',
  },
];

export const TASK_SETS: Record<string, AgentTask[]> = {
  exhaustive: AGENT_TASKS,
  realistic: REALISTIC_TASKS,
};
