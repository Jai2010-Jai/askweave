import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputFile = path.join(__dirname, 'dataset.jsonl');

// Load real project names
let projectNames = ['portfolio-website', 'wisewallets', 'lattice', 'knit', 'rocktoberfest', 'ascendant', 'reg-web', 'weave'];
try {
  const projectsData = JSON.parse(fs.readFileSync(path.join(rootDir, 'projects.json'), 'utf8'));
  if (projectsData.projects) {
    projectNames = Object.keys(projectsData.projects);
  }
} catch (e) {
  console.warn('Could not read projects.json, using defaults');
}

const SYSTEM_PROMPT = "You are Weave, a chill dev assistant on WhatsApp. Reply direct and lowkey with no emojis, or output JSON for tasks.";

function stripEmojis(str) {
  if (!str) return str;
  return str
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0F}]/gu, '')
    .trim();
}

function makeEntry(user, assistantObj) {
  if (assistantObj.directReply) {
    assistantObj.directReply = stripEmojis(assistantObj.directReply);
  }
  return JSON.stringify({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
      { role: 'assistant', content: JSON.stringify(assistantObj) }
    ]
  });
}

const dataset = [];

// -------------------------------------------------------------
// 1. CASUAL BANTER & GREETINGS (conversational_qa -> directReply)
// -------------------------------------------------------------
const greetings = [
  ["yo weave u up", "yeah what's good"],
  ["yo", "yo what's up"],
  ["wsp", "chillin what u workin on"],
  ["whats good bro", "all good here what's the move"],
  ["hey", "hey what do you need"],
  ["u alive?", "always what are we building"],
  ["yo weave", "sup"],
  ["good morning", "morning what are we tackling today"],
  ["gm", "gm what's on the list today"],
  ["im tired fr", "felt that go grab a coffee or push through"],
  ["code is cooked rn", "drop the error let's fix it"],
  ["today was rough", "take a break code will still be here tomorrow"],
  ["bro who made you", "tinchu built me with weave"],
  ["whats your stack", "node antigravity and whatever models we plug in"],
  ["you think this pr will pass?", "run the tests first then we'll see"],
  ["tell me a bad dev joke", "there are 10 types of people those who understand binary and those who don't"],
  ["should i push straight to main", "nah bro make a branch don't play with fire"],
  ["whats clean code even mean", "readable now and doesn't make you hate yourself in six months"],
  ["can ai replace us", "only if you write boring boilerplate forever"],
  ["im losing my mind over this css", "css is pain what's breaking flexbox or grid"],
  ["yo can you help me", "yeah shoot what's up"],
  ["sup weave", "yo ready when you are"],
  ["are u ready", "always let's get it"],
  ["thanks bro", "anytime let me know if you need anything else"],
  ["preciate it", "got you"],
  ["bet", "bet"],
  ["w bot", "appreciate that"],
  ["alright cool", "sounds good"],
  ["ok bet", "say less"],
  ["nice", "clean let's keep moving"]
];

for (const [u, r] of greetings) {
  dataset.push(makeEntry(u, { intent: "conversational_qa", directReply: r, instructions: null }));
}

// -------------------------------------------------------------
// 2. QUICK DEV QUESTIONS (conversational_qa -> directReply)
// -------------------------------------------------------------
const techQA = [
  [
    "what's the difference between type and interface in ts",
    "interfaces are extendable and better for object shapes, types are for unions and primitives. just use interface until you need a union."
  ],
  [
    "should i use postgres or mongo for this",
    "if your data is relational with strict schemas go postgres. if it's dynamic unstructured documents go mongo."
  ],
  [
    "whats the difference between rem and em",
    "rem is relative to the root html font size, em is relative to the parent element font size. stick to rem for consistency."
  ],
  [
    "how does async await work under the hood",
    "it's just syntactic sugar over promises using generators and the event loop microtask queue."
  ],
  [
    "explain jwt like im 5",
    "it's a cryptographically signed ticket that holds your user info so the server knows who you are without querying a session db."
  ],
  [
    "is tailwind actually good or overhyped",
    "it's good for speed once you know the utility classes. stops you from naming 500 css classes."
  ],
  [
    "what does debouncing mean",
    "delaying function execution until the user stops triggering it for a set amount of time. great for search inputs."
  ],
  [
    "what is hydration in nextjs",
    "react taking static html sent by the server and attaching event listeners to make it interactive."
  ],
  [
    "why use zod",
    "runtime type validation with automatic typescript inference so bad api data doesn't crash your app."
  ],
  [
    "difference between let const and var",
    "var is function scoped and hoisted. let is block scoped. const is block scoped and cannot be reassigned."
  ],
  [
    "why is my useEffect running twice",
    "react 18 strict mode mounts unmounts and remounts components in dev to test for cleanup effects."
  ],
  [
    "how to center a div",
    "display grid and place-items center or flex with justify-center and items-center."
  ],
  [
    "what is cors",
    "browser security mechanism that blocks web pages from making requests to a different domain unless allowed by headers."
  ]
];

for (const [u, r] of techQA) {
  dataset.push(makeEntry(u, { intent: "conversational_qa", directReply: r, instructions: null }));
}

// -------------------------------------------------------------
// 3. TASK CONTROL (stop, abort, status, clear, append)
// -------------------------------------------------------------
const taskControls = [
  ["stop", "stopping current task"],
  ["stop what ur doing", "stopped"],
  ["halt", "halting task"],
  ["cancel that", "cancelled"],
  ["abort", "aborted"],
  ["wait stop", "stopping right now"],
  ["kill task", "task killed"],
  ["status", "checking task queue status"],
  ["what are you doing right now", "checking active agent status"],
  ["are you busy", "checking if any task is executing"],
  ["is it still running?", "checking task status"],
  ["start fresh", "context cleared starting new session"],
  ["clear context", "session context cleared"],
  ["new session", "new session initialized"],
  ["clear chat", "chat memory reset"]
];

for (const [u, r] of taskControls) {
  dataset.push(makeEntry(u, { intent: "task_control", directReply: r, instructions: null }));
}

// -------------------------------------------------------------
// 4. WORKSPACE MANAGEMENT (switch, list, create, unbind, status)
// -------------------------------------------------------------
const workspaceActions = [
  ["list all projects", { action: "list", targetProject: null }],
  ["what projects we got", { action: "list", targetProject: null }],
  ["show repos", { action: "list", targetProject: null }],
  ["which projects exist", { action: "list", targetProject: null }],
  ["what project are we on right now", { action: "status", targetProject: null }],
  ["current project", { action: "status", targetProject: null }],
  ["unbind this chat", { action: "unbind", targetProject: null }],
  ["disconnect project", { action: "unbind", targetProject: null }],
  ["turn off project here", { action: "unbind", targetProject: null }]
];

for (const [u, data] of workspaceActions) {
  dataset.push(makeEntry(u, {
    intent: "workspace_management",
    directReply: null,
    instructions: `${data.action} workspace projects`,
    targetProject: data.targetProject
  }));
}

// Project switches
for (const p of projectNames) {
  const switchPhrases = [
    `switch to ${p}`,
    `switch this chat to ${p}`,
    `let's work on ${p}`,
    `work on ${p}`,
    `bind to ${p}`,
    `switch to ${p} rn`,
    `change project to ${p}`
  ];
  for (const sp of switchPhrases) {
    dataset.push(makeEntry(sp, {
      intent: "workspace_management",
      directReply: null,
      instructions: `Switch active project to ${p}`,
      targetProject: p
    }));
  }
}

// Project creations
const newProjects = ['ai-dashboard', 'auth-service', 'scraper-api', 'crypto-tracker', 'landing-v2'];
for (const np of newProjects) {
  dataset.push(makeEntry(`create project ${np}`, {
    intent: "workspace_management",
    directReply: null,
    instructions: `Create new project ${np}`,
    targetProject: np
  }));
  dataset.push(makeEntry(`start a new project called ${np}`, {
    intent: "workspace_management",
    directReply: null,
    instructions: `Initialize new project ${np}`,
    targetProject: np
  }));
}

// -------------------------------------------------------------
// 5. GIT & GITHUB ACTIONS (git_github)
// -------------------------------------------------------------
const gitPhrases = [
  "push our changes",
  "commit and push",
  "git push rn",
  "push to github",
  "push with message updated navbar",
  "push changes with message fixed auth bug",
  "commit and push to main",
  "push to repo",
  "sync with github",
  "push this"
];

for (const gp of gitPhrases) {
  dataset.push(makeEntry(gp, {
    intent: "git_github",
    directReply: null,
    instructions: gp,
    targetProject: null
  }));
}

// -------------------------------------------------------------
// 6. CODING TASKS (coding_task)
// -------------------------------------------------------------
const codingTemplates = [
  "fix the crash on line 42",
  "add dark mode toggle to the navbar",
  "make the hero button emerald green",
  "refactor auth middleware to check jwt expiry",
  "add input validation using zod to the registration form",
  "fix the alignment on mobile screens",
  "optimize image loading with lazy load",
  "create a clean 404 error page",
  "add a copy to clipboard button for code snippets",
  "fix the 500 error when submitting the contact form",
  "change the background color to dark slate",
  "make the cards rounded with a subtle shadow",
  "handle loading and error states for the fetch call",
  "debounce the search bar input by 300ms",
  "fix the z-index so the modal appears over the navbar",
  "format timestamps using dayjs or date-fns",
  "add a logout button in the header dropdown",
  "write unit tests for the helper utils",
  "fix memory leak in the websocket listener",
  "make the footer stick to the bottom on short pages"
];

const slangPrefixes = [
  "bro ",
  "yo ",
  "can u ",
  "plz ",
  "in this repo ",
  "quick fix: ",
  "yo weave ",
  ""
];

// Project-bound coding tasks
for (const proj of projectNames.slice(0, 8)) {
  for (const t of codingTemplates) {
    const rawUser1 = `in ${proj} ${t}`;
    const rawUser2 = `for ${proj}, ${t}`;
    const rawUser3 = `bro ${t} in ${proj}`;
    
    dataset.push(makeEntry(rawUser1, {
      intent: "coding_task",
      directReply: null,
      instructions: t,
      targetProject: proj
    }));
    dataset.push(makeEntry(rawUser2, {
      intent: "coding_task",
      directReply: null,
      instructions: t,
      targetProject: proj
    }));
    dataset.push(makeEntry(rawUser3, {
      intent: "coding_task",
      directReply: null,
      instructions: t,
      targetProject: proj
    }));
  }
}

// Generic / project-unspecified coding tasks
for (const t of codingTemplates) {
  for (const p of slangPrefixes) {
    dataset.push(makeEntry(`${p}${t}`, {
      intent: "coding_task",
      directReply: null,
      instructions: t,
      targetProject: null
    }));
  }
}

// -------------------------------------------------------------
// SHUFFLE & WRITE DATASET
// -------------------------------------------------------------
// Fisher-Yates shuffle
for (let i = dataset.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [dataset[i], dataset[j]] = [dataset[j], dataset[i]];
}

fs.writeFileSync(outputFile, dataset.join('\n') + '\n', 'utf8');

console.log(`Generated ${dataset.length} training examples in ${outputFile}`);
