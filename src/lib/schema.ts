/**
 * The Notion schema, in one place, so the seeder and the app can never drift.
 *
 * Design intent — the whole system hangs off ONE piece of user input:
 * `Task.Completed On`. The Daily Tracker, the activity heatmap, streaks, and
 * every rollup are *derived* from that date. Nothing is logged twice.
 *
 * Extensibility — the hierarchy is generic (Area -> Topic -> Task). DSA is
 * simply the first Area. Adding "System Design" or "LLD" later means inserting
 * one Area row plus its Topics; no schema change, no rebuild.
 */

/** Property names. Referenced everywhere instead of raw strings. */
export const P = {
  area: {
    name: 'Name',
    slug: 'Slug',
    emoji: 'Emoji',
    weight: 'Weight',
    status: 'Status',
    order: 'Order',
    tasks: 'Tasks',
    topics: 'Topics',
    totalTasks: 'Total Tasks',
    doneTasks: 'Completed Tasks',
    progress: 'Progress',
  },
  topic: {
    name: 'Name',
    area: 'Area',
    order: 'Order',
    path: 'Path',
    tasks: 'Tasks',
    totalTasks: 'Total Tasks',
    doneTasks: 'Completed Tasks',
    progress: 'Progress',
  },
  task: {
    name: 'Name',
    done: 'Done',
    completedOn: 'Completed On',
    area: 'Area',
    topic: 'Topic',
    heading: 'Heading',
    difficulty: 'Difficulty',
    order: 'Order',
    headingOrder: 'Heading Order',
    taskOrder: 'Task Order',
    tuf: 'TUF Link',
    leetcode: 'LeetCode Link',
    gfg: 'GFG Link',
    youtube: 'YouTube Link',
    bookmarked: 'Bookmarked',
    revisit: 'Revisit',
    notes: 'Notes',
    sourceId: 'Source Id',
  },
  daily: {
    name: 'Name',
    date: 'Date',
    note: 'Note',
    hours: 'Hours',
    mood: 'Mood',
  },
  job: {
    role: 'Role',
    company: 'Company',
    status: 'Status',
    source: 'Source',
    location: 'Location',
    workMode: 'Work Mode',
    jobUrl: 'Job URL',
    applyUrl: 'Apply URL',
    match: 'Match',
    fit: 'Why It Fits',
    howToApply: 'How To Apply',
    salary: 'Salary',
    experience: 'Experience',
    skills: 'Skills',
    postedOn: 'Posted On',
    foundOn: 'Found On',
    appliedOn: 'Applied On',
    appliedVia: 'Applied Via',
    resume: 'Resume Used',
    referral: 'Referral',
    contact: 'Contact',
    nextStep: 'Next Step',
    followUpOn: 'Follow Up On',
    lastUpdate: 'Last Update',
    heardBackOn: 'Heard Back On',
    addedBy: 'Added By',
    notes: 'Notes',
    key: 'Dedupe Key',
  },
  profile: {
    name: 'Name',
    targetRoles: 'Target Roles',
    experience: 'Experience',
    locations: 'Locations',
    workModes: 'Work Modes',
    skills: 'Skills',
    salary: 'Salary',
    noticePeriod: 'Notice Period',
    mustHaves: 'Must Haves',
    dealBreakers: 'Deal Breakers',
    targetCompanies: 'Target Companies',
    avoidCompanies: 'Avoid Companies',
    resume: 'Resume',
  },
} as const;

export const AREA_STATUS = ['Active', 'Planned', 'Paused', 'Done'] as const;
export const DIFFICULTY = ['Easy', 'Medium', 'Hard'] as const;
export const MOOD = ['Great', 'Good', 'Okay', 'Rough'] as const;

export type Difficulty = (typeof DIFFICULTY)[number];

/**
 * An application's whole life, in order. `Status` is the one field that moves;
 * Applied On, Heard Back On and Last Update are stamped from it, the same way
 * a tick stamps Completed On, so nobody has to remember to fill them in.
 */
export const JOB_STATUS = [
  'Found',
  'Shortlisted',
  'Applied',
  'Assessment',
  'Interviewing',
  'Offer',
  'Rejected',
  'Ghosted',
  'Withdrawn',
  'Skipped',
] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export const JOB_SOURCES = [
  'LinkedIn',
  'Naukri',
  'Glassdoor',
  'Workday',
  'foundit',
  'Wellfound',
  'Instahyre',
  'Cutshort',
  'Greenhouse',
  'Lever',
  'Ashby',
  'Company site',
  'Referral',
  'Other',
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const WORK_MODES = ['Remote', 'Hybrid', 'On-site'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const APPLIED_VIA = [
  'Company site',
  'LinkedIn Easy Apply',
  'Naukri',
  'Referral',
  'Email',
  'Recruiter',
  'Other',
] as const;
export type AppliedVia = (typeof APPLIED_VIA)[number];

/** Who put a row there: you from the tracker, or an AI tool through the API. */
export const ADDED_BY = ['You', 'AI'] as const;
export type AddedBy = (typeof ADDED_BY)[number];

// ---------------------------------------------------------------------------
// Property builders (thin wrappers so the seeder stays readable)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
const title = () => ({ title: {} }) as any;
const text = () => ({ rich_text: {} }) as any;
const num = (format?: string) => ({ number: format ? { format } : {} }) as any;
const check = () => ({ checkbox: {} }) as any;
const date = () => ({ date: {} }) as any;
const url = () => ({ url: {} }) as any;
const select = (options: readonly string[], colors?: Record<string, string>) =>
  ({
    select: {
      options: options.map((name) => ({
        name,
        ...(colors?.[name] ? { color: colors[name] } : {}),
      })),
    },
  }) as any;
const multiSelect = (options: readonly string[] = []) =>
  ({ multi_select: { options: options.map((name) => ({ name })) } }) as any;
const relation = (dataSourceId: string, syncedName: string) =>
  ({
    relation: {
      data_source_id: dataSourceId,
      type: 'dual_property',
      dual_property: { synced_property_name: syncedName },
    },
  }) as any;
const rollup = (
  relationProperty: string,
  rollupProperty: string,
  fn: 'count' | 'checked' | 'percent_checked',
) => ({ rollup: { relation_property_name: relationProperty, rollup_property_name: rollupProperty, function: fn } }) as any;

// ---------------------------------------------------------------------------
// Database definitions
// ---------------------------------------------------------------------------

/** Step 1 — Areas. No relations yet; Topics and Tasks attach themselves later. */
export function areasProperties() {
  return {
    [P.area.name]: title(),
    [P.area.slug]: text(),
    [P.area.emoji]: text(),
    [P.area.weight]: num('number'),
    [P.area.status]: select(AREA_STATUS, {
      Active: 'green',
      Planned: 'gray',
      Paused: 'yellow',
      Done: 'blue',
    }),
    [P.area.order]: num('number'),
  };
}

/** Step 2 — Topics (the sheet's *sections*). Dual-relates back to Areas. */
export function topicsProperties(areasDs: string) {
  return {
    [P.topic.name]: title(),
    [P.topic.order]: num('number'),
    [P.topic.path]: text(),
    [P.topic.area]: relation(areasDs, P.area.topics),
  };
}

/**
 * Step 3 — Tasks (the sheet's *questions*). `Heading` holds the original
 * subcategory as a select so Notion can group by it inside a topic view,
 * which preserves section -> heading -> question without a fourth database.
 */
export function tasksProperties(
  areasDs: string,
  topicsDs: string,
  headings: readonly string[],
  headingAsSelect = true,
) {
  return {
    [P.task.name]: title(),
    [P.task.done]: check(),
    [P.task.completedOn]: date(),
    [P.task.area]: relation(areasDs, P.area.tasks),
    [P.task.topic]: relation(topicsDs, P.topic.tasks),
    // A select lets Notion group a topic view by heading, which is how the
    // section -> heading -> question hierarchy stays visible without a fourth
    // database. Notion has historically rejected commas in option names, so the
    // seeder falls back to rich_text rather than ever altering a heading name.
    [P.task.heading]: headingAsSelect ? select(headings) : text(),
    // The source sheet carries no difficulty data, so every row is seeded
    // blank. The field exists so analytics light up as you fill it in.
    [P.task.difficulty]: select(DIFFICULTY, { Easy: 'blue', Medium: 'blue', Hard: 'blue' }),
    [P.task.order]: num('number'),
    [P.task.headingOrder]: num('number'),
    [P.task.taskOrder]: num('number'),
    [P.task.tuf]: url(),
    [P.task.leetcode]: url(),
    [P.task.gfg]: url(),
    [P.task.youtube]: url(),
    [P.task.bookmarked]: check(),
    [P.task.revisit]: check(),
    [P.task.notes]: text(),
    [P.task.sourceId]: text(),
  };
}

/** Step 4 — rollups, added once the Tasks relation exists on Areas/Topics. */
export function areaRollups() {
  return {
    [P.area.totalTasks]: rollup(P.area.tasks, P.task.done, 'count'),
    [P.area.doneTasks]: rollup(P.area.tasks, P.task.done, 'checked'),
    [P.area.progress]: rollup(P.area.tasks, P.task.done, 'percent_checked'),
  };
}

export function topicRollups() {
  return {
    [P.topic.totalTasks]: rollup(P.topic.tasks, P.task.done, 'count'),
    [P.topic.doneTasks]: rollup(P.topic.tasks, P.task.done, 'checked'),
    [P.topic.progress]: rollup(P.topic.tasks, P.task.done, 'percent_checked'),
  };
}

/** Optional journal. The Daily Tracker itself needs none of this — it is
 *  derived from `Task.Completed On`. This is purely for notes/hours/mood. */
export function dailyProperties() {
  return {
    [P.daily.name]: title(),
    [P.daily.date]: date(),
    [P.daily.note]: text(),
    [P.daily.hours]: num('number'),
    [P.daily.mood]: select(MOOD, { Great: 'green', Good: 'blue', Okay: 'yellow', Rough: 'red' }),
  };
}

/**
 * Job Applications. One row per posting, whether an AI tool found it or you
 * added it by hand.
 *
 * The description and the timeline live in the page body rather than in
 * properties: a timeline entry is appended, never rewritten, so an update from
 * the tracker and one from an AI tool at the same moment both land. A text
 * property would have been read-modify-write, and one of the two would lose.
 */
export function jobsProperties() {
  return {
    [P.job.role]: title(),
    [P.job.company]: text(),
    [P.job.status]: select(JOB_STATUS, {
      Found: 'gray',
      Shortlisted: 'purple',
      Applied: 'blue',
      Assessment: 'yellow',
      Interviewing: 'orange',
      Offer: 'green',
      Rejected: 'red',
      Ghosted: 'brown',
      Withdrawn: 'default',
      Skipped: 'default',
    }),
    [P.job.source]: select(JOB_SOURCES),
    [P.job.location]: text(),
    [P.job.workMode]: select(WORK_MODES, { Remote: 'green', Hybrid: 'blue', 'On-site': 'gray' }),
    [P.job.jobUrl]: url(),
    [P.job.applyUrl]: url(),
    [P.job.match]: num('number'),
    [P.job.fit]: text(),
    [P.job.howToApply]: text(),
    [P.job.salary]: text(),
    [P.job.experience]: text(),
    [P.job.skills]: multiSelect(),
    [P.job.postedOn]: date(),
    [P.job.foundOn]: date(),
    [P.job.appliedOn]: date(),
    [P.job.appliedVia]: select(APPLIED_VIA),
    [P.job.resume]: text(),
    [P.job.referral]: text(),
    [P.job.contact]: text(),
    [P.job.nextStep]: text(),
    [P.job.followUpOn]: date(),
    [P.job.lastUpdate]: date(),
    [P.job.heardBackOn]: date(),
    [P.job.addedBy]: select(ADDED_BY, { You: 'blue', AI: 'purple' }),
    [P.job.notes]: text(),
    [P.job.key]: text(),
  };
}

/**
 * The job search profile, as a one-row database.
 *
 * A database rather than a plain page because a page has no properties, and
 * every field here has to be readable and writable in one call. A page body
 * would have meant deleting and re-appending blocks on every save.
 */
export function jobProfileProperties() {
  return {
    [P.profile.name]: title(),
    [P.profile.targetRoles]: text(),
    [P.profile.experience]: text(),
    [P.profile.locations]: text(),
    [P.profile.workModes]: multiSelect(WORK_MODES),
    [P.profile.skills]: text(),
    [P.profile.salary]: text(),
    [P.profile.noticePeriod]: text(),
    [P.profile.mustHaves]: text(),
    [P.profile.dealBreakers]: text(),
    [P.profile.targetCompanies]: text(),
    [P.profile.avoidCompanies]: text(),
    [P.profile.resume]: text(),
  };
}
