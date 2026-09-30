/**
 * Self-tests for job tracking: the domain rules, the MCP protocol, the board
 * readers, the company-site matcher and the Notion writes — everything that
 * can be checked without a live Notion workspace or a running crawler.
 *
 * Run as part of `npm run test`.
 */
import {
  coerceSource,
  coerceStatus,
  cleanUrl,
  dedupeKey,
  findDuplicate,
  followUpFor,
  formatEvent,
  parseEvent,
  parseEventInput,
  parseJobPatch,
  parseNewJob,
  parseProfile,
  parseProfilePatch,
  pipelineSummary,
  postingKey,
  searchJobs,
  signature,
  sourceFromUrl,
  stampsFor,
  statusAfterEvent,
  textRuns,
  NO_JUDGMENT,
  chunkText,
  computeMatch,
  formatScores,
  isRepost,
  judge,
  levelFitFor,
  parseEvaluation,
  parseReport,
  parseScores,
  reportBlocks,
  systemRedFlags,
  verdictFor,
  type EvaluationReport,
  type Job,
} from '../src/lib/jobs';
import { bearerKey, generateApiKey, hashApiKey, looksLikeApiKey, cleanKeyName } from '../src/lib/api-keys';
import { MAX_BATCH, PROTOCOL_VERSIONS, ToolError, errorResult, handleBody, handleMessage, jsonResult, type ServerDef } from '../src/lib/mcp/protocol';
import { JOB_TRACKER_SERVER } from '../src/lib/mcp/tools';
import { INSTRUCTIONS, PLAYBOOK } from '../src/lib/mcp/playbook';
import {
  BOARD_IDS,
  blockedReason,
  experienceFromText,
  keepForLevel,
  parseCrawl,
  placeFits,
  planBoardSearch,
  postedFromText,
  readCards,
  readPostingPage,
  readWellfound,
  salaryFromText,
  seniorityOf,
} from '../src/lib/job-search';
import { CAREER_SITES, companiesFrom, locationMatches, titleMatches, workdayPosted } from '../src/lib/job-search/career-sites';
import { JobsError, ensureJobsSchema, eventBlock, getJob, initialBody, jobProperties, logJobEvent, mapJob, missingProperties, pageIdFromUrl, saveEvaluation, splitBody, updateJob } from '../src/lib/jobs/notion';
import { jobsProperties } from '../src/lib/schema';
import { BOARD_IDS as CONNECTOR_BOARDS, refuseUrl } from '../connector/job-hunt.mjs';
import { P } from '../src/lib/schema';
import type { Tenant } from '../src/lib/tenant';
import { clampInt, cn } from '../src/lib/utils';

type Check = (name: string, cond: boolean, detail?: string) => void;

const TODAY = '2026-09-29';

function job(p: Partial<Job>): Job {
  return {
    ...NO_JUDGMENT,
    id: 'j1', role: 'Software Engineer', company: 'Acme', status: 'Found', source: 'LinkedIn', location: 'Bengaluru',
    workMode: null, jobUrl: null, applyUrl: null, match: null, fit: '', howToApply: '', salary: '', experience: '',
    skills: [], postedOn: null, appliedOn: null, appliedVia: null, resume: '', referral: '', contact: '', nextStep: '',
    followUpOn: null, notes: '', foundOn: TODAY, lastUpdate: TODAY, heardBackOn: null, addedBy: 'AI', key: '',
    notionUrl: '', createdAt: '2026-09-29T00:00:00.000Z', ...p,
  };
}

export async function jobTests(check: Check, section: (s: string) => void) {
  // -----------------------------------------------------------------------
  section('Jobs: status stamps');
  {
    const none = { appliedOn: null, heardBackOn: null };
    check('moving to Applied stamps Applied On', stampsFor(none, 'Applied', TODAY).appliedOn === TODAY);
    check('Applied does not stamp Heard Back On', stampsFor(none, 'Applied', TODAY).heardBackOn === undefined);
    const iv = stampsFor(none, 'Interviewing', TODAY);
    check('skipping straight to Interviewing stamps both', iv.appliedOn === TODAY && iv.heardBackOn === TODAY);
    check('a stamp is never overwritten', stampsFor({ appliedOn: '2026-09-01', heardBackOn: null }, 'Applied', TODAY).appliedOn === undefined);
    check('Ghosted is not a reply', stampsFor({ appliedOn: '2026-09-01', heardBackOn: null }, 'Ghosted', TODAY).heardBackOn === undefined);
    check('Skipped stamps nothing', Object.keys(stampsFor(none, 'Skipped', TODAY)).length === 0);
  }

  section('Jobs: events move the status');
  {
    check('an interview moves Applied to Interviewing', statusAfterEvent('Applied', 'interview') === 'Interviewing');
    check('logging "applied" never demotes Interviewing', statusAfterEvent('Interviewing', 'applied') === null);
    check('a rejection closes anything', statusAfterEvent('Interviewing', 'rejection') === 'Rejected');
    check('an offer after an interview', statusAfterEvent('Interviewing', 'offer') === 'Offer');
    check('an interview reopens a Ghosted application', statusAfterEvent('Ghosted', 'interview') === 'Interviewing');
    check('a note moves nothing', statusAfterEvent('Applied', 'note') === null);
    check('a reply moves nothing on its own', statusAfterEvent('Applied', 'reply') === null);
  }

  section('Jobs: timeline lines round-trip');
  {
    const e = { date: TODAY, kind: 'interview' as const, text: 'Round 1 with the EM' };
    const back = parseEvent(formatEvent(e));
    check('format → parse keeps date, kind and text', back?.date === TODAY && back.kind === 'interview' && back.text === 'Round 1 with the EM', JSON.stringify(back));
    check('an event without text round-trips', parseEvent(formatEvent({ date: TODAY, kind: 'applied', text: '' }))?.kind === 'applied');
    const hand = parseEvent('called the recruiter, no answer');
    check('a hand-written line is kept as a note', hand?.kind === 'note' && hand.text.includes('recruiter'));
    check('newlines never reach the stored line', !formatEvent({ date: TODAY, kind: 'note', text: 'a\nb' }).includes('\n'));
  }

  section('Jobs: follow-ups');
  {
    check('a follow-up date that has arrived is due', followUpFor(job({ status: 'Applied', followUpOn: '2026-09-28' }), TODAY)?.kind === 'due');
    check('a week of silence is a nudge', followUpFor(job({ status: 'Applied', appliedOn: '2026-09-20' }), TODAY)?.kind === 'nudge');
    check('three weeks of silence is stale', followUpFor(job({ status: 'Applied', appliedOn: '2026-09-01' }), TODAY)?.kind === 'stale');
    check('a reply ends the nudging', followUpFor(job({ status: 'Applied', appliedOn: '2026-09-01', heardBackOn: '2026-09-05' }), TODAY) === null);
    check('closed jobs never need a follow-up', followUpFor(job({ status: 'Rejected', followUpOn: '2026-09-01' }), TODAY) === null);
    check('a planned future follow-up silences the nudge', followUpFor(job({ status: 'Applied', appliedOn: '2026-09-20', followUpOn: '2026-10-05' }), TODAY) === null);
  }

  section('Jobs: pipeline summary');
  {
    const s = pipelineSummary(
      [
        job({ id: 'a', status: 'Found' }),
        job({ id: 'b', status: 'Applied', appliedOn: '2026-09-27' }),
        job({ id: 'c', status: 'Interviewing', appliedOn: '2026-09-10', heardBackOn: '2026-09-15' }),
        job({ id: 'd', status: 'Rejected', appliedOn: '2026-09-01' }),
        job({ id: 'e', status: 'Skipped' }),
      ],
      TODAY,
    );
    check('counts every status', s.total === 5 && s.byStatus.Found === 1 && s.byStatus.Skipped === 1);
    check('applied counts everything past applying, not Skipped', s.applied === 3, `got ${s.applied}`);
    check('a rejection counts as hearing back', s.heardBack === 2, `got ${s.heardBack}`);
    check('response rate is heard back over applied', Math.abs(s.responseRate - 2 / 3) < 1e-9);
    check('groups add up to the total', Object.values(s.byGroup).reduce((a, b) => a + b, 0) === 5);
    check('applied in the last 7 days', s.appliedLast7Days === 1);
  }

  section('Jobs: the same posting, recognised');
  {
    const li1 = postingKey('https://in.linkedin.com/jobs/view/software-engineer-at-acme-4469142310?position=1&refId=x&trackingId=y');
    const li2 = postingKey('https://www.linkedin.com/jobs/view/4469142310/');
    check('LinkedIn: country subdomain, slug and tracking do not matter', li1 === 'linkedin:4469142310' && li1 === li2, `${li1} vs ${li2}`);
    check('Naukri id from the listing URL', postingKey('https://www.naukri.com/job-listings-sde-2-deloitte-bengaluru-0-to-5-years-080426034452?src=x') === 'naukri:080426034452');
    check('Glassdoor id from jl=', postingKey('https://www.glassdoor.co.in/job-listing/x-JV_KO0,17.htm?jl=1010270983939') === 'glassdoor:1010270983939');
    check(
      'Workday ignores the /apply suffix',
      postingKey('https://visa.wd5.myworkdayjobs.com/Visa/job/IN---Bengaluru-India/Software-Engineer_REF088484W/apply') ===
        postingKey('https://visa.wd5.myworkdayjobs.com/Visa/job/IN---Bengaluru-India/Software-Engineer_REF088484W'),
    );
    check('Greenhouse by job id', postingKey('https://job-boards.greenhouse.io/okta/jobs/8128435') === 'greenhouse:8128435');
    check('Lever by posting uuid', postingKey('https://jobs.lever.co/weekdayworks/25fb7970-5052-4fc7-8f42-b8b20f1e9f25/apply') === 'lever:25fb7970-5052-4fc7-8f42-b8b20f1e9f25');
    check('Wellfound by job id', postingKey('https://wellfound.com/jobs/4716782-software-engineer') === 'wellfound:4716782');
    check('foundit by trailing id', postingKey('https://www.foundit.in/job/software-engineer-visa-bengaluru-69182454') === 'foundit:69182454');
    check('javascript: is not a posting', postingKey('javascript:alert(1)') === null);

    const existing = [job({ id: 'x', key: 'linkedin:4469142310', company: 'Acme Pvt Ltd', role: 'Software Engineer', location: 'Bengaluru, India' })];
    check('a repeat of the same posting is a duplicate', findDuplicate({ jobUrl: 'https://www.linkedin.com/jobs/view/4469142310', applyUrl: null, company: 'Other', role: 'Other', location: '' }, existing)?.reason === 'same posting');
    check(
      'the same role at the same company in the same city, cross-posted, is a duplicate',
      findDuplicate({ jobUrl: 'https://www.naukri.com/job-listings-x-123456789012', applyUrl: null, company: 'Acme', role: 'Software Engineer', location: 'Bengaluru' }, existing)?.reason === 'same role, company and city',
    );
    check(
      'a different role at the same company is not',
      findDuplicate({ jobUrl: null, applyUrl: null, company: 'Acme', role: 'Data Engineer', location: 'Bengaluru' }, existing) === null,
    );
    check('company suffixes do not split a signature', signature({ company: 'Acme Technologies Pvt. Ltd.', role: 'SDE', location: 'Pune' }) === signature({ company: 'ACME', role: 'SDE', location: 'Pune, India' }));
    check('with no link, the key falls back to the signature', dedupeKey({ jobUrl: null, applyUrl: null, company: 'Acme', role: 'SDE', location: 'Pune' }).startsWith('sig:'));
  }

  section('Jobs: input from forms and AI tools');
  {
    const ok = parseNewJob(
      { role: ' Software Engineer ', company: 'Acme', status: 'oa', work_mode: 'onsite', job_url: 'https://www.naukri.com/job-listings-x-123456789012?utm_source=ai', skills: 'React, Node.js, react', match: '82%', posted_on: '2026-09-27T10:00:00Z' },
      { status: 'Found' },
    );
    check('a loose AI payload is accepted', ok.ok, ok.ok ? '' : ok.error);
    if (ok.ok) {
      check('"oa" means Assessment', ok.value.status === 'Assessment');
      check('"onsite" means On-site', ok.value.workMode === 'On-site');
      check('the source is read off the URL', ok.value.source === 'Naukri');
      check('utm parameters are stripped', !ok.value.jobUrl?.includes('utm_'));
      check('skills are split and de-duplicated', ok.value.skills.length === 2, JSON.stringify(ok.value.skills));
      check('a match sent as input is ignored: only the rubric sets it', !('match' in ok.value));
      check('an ISO timestamp becomes a day', ok.value.postedOn === '2026-09-27');
      check('the role is trimmed', ok.value.role === 'Software Engineer');
    }
    check('status defaults per caller', (() => { const r = parseNewJob({ role: 'a', company: 'b' }, { status: 'Shortlisted' }); return r.ok && r.value.status === 'Shortlisted'; })());
    check('role is required', !parseNewJob({ company: 'Acme' }, { status: 'Found' }).ok);
    check('a javascript: link is refused', !parseNewJob({ role: 'a', company: 'b', job_url: 'javascript:alert(1)' }, { status: 'Found' }).ok);
    check('a bad date is refused, not guessed', !parseNewJob({ role: 'a', company: 'b', posted_on: '3 days ago' }, { status: 'Found' }).ok);
    check('an unknown status is refused', !parseNewJob({ role: 'a', company: 'b', status: 'maybe' }, { status: 'Found' }).ok);
    check('commas never reach a skill name (Notion refuses them)', (() => { const r = parseNewJob({ role: 'a', company: 'b', skills: ['C, C++'] }, { status: 'Found' }); return r.ok && r.value.skills.every((x) => !x.includes(',')); })());

    const patch = parseJobPatch({ follow_up_on: '2026-10-03', notes: '' });
    check('a patch holds only what was sent', patch.ok && Object.keys(patch.value).sort().join() === 'followUpOn,notes');
    check('an empty string clears a field', patch.ok && patch.value.notes === '');
    check('a patch cannot blank the role', !parseJobPatch({ role: '' }).ok);
    check('camelCase is accepted too', (() => { const r = parseJobPatch({ followUpOn: '2026-10-03' }); return r.ok && r.value.followUpOn === '2026-10-03'; })());

    const ev = parseEventInput({ kind: 'OA', text: 'link came by email' });
    check('event kinds take synonyms ("OA")', ev.ok && ev.value.kind === 'assessment');
    check('events move the status unless told not to', ev.ok && ev.value.moveStatus === true);
    check('move_status false is honoured', (() => { const r = parseEventInput({ kind: 'interview', move_status: false }); return r.ok && !r.value.moveStatus; })());
    check('system kinds cannot be logged by hand', !parseEventInput({ kind: 'status' }).ok);

    const prof = parseProfile({ target_roles: 'SDE-1', work_modes: ['remote', 'Hybrid', 'nonsense'], resume: 'x'.repeat(50) });
    check('profile work modes are coerced and filtered', prof.ok && prof.value.workModes.join() === 'Remote,Hybrid');
    const pp = parseProfilePatch({ notice_period: '30 days' });
    check('a profile patch holds only what was sent', pp.ok && Object.keys(pp.value).join() === 'noticePeriod');
    check('long text is split into Notion-sized runs', textRuns('a'.repeat(4500)).length === 3 && textRuns('a'.repeat(4500))[2].length === 500);
    check('a URL with only tracking left is still the URL', cleanUrl('https://example.com/jobs/1?utm_medium=x') === 'https://example.com/jobs/1');
    check('an unknown host is a company site', sourceFromUrl('https://careers.acme.com/job/1') === 'Company site');
    check('search matches across fields', searchJobs([job({ company: 'Stripe', skills: ['Go'] })], 'stripe go').length === 1);
  }

  // -----------------------------------------------------------------------
  section('API keys');
  {
    const k = generateApiKey();
    check('a key is jt_ + 43 url-safe characters', looksLikeApiKey(k.key), k.key.slice(0, 5));
    check('the stored hash is the SHA-256 of the key', k.hash === hashApiKey(k.key) && /^[0-9a-f]{64}$/.test(k.hash));
    check('the shown prefix is only the start', k.prefix.length === 10 && k.key.startsWith(k.prefix));
    check('two keys never match', generateApiKey().key !== k.key);
    check('Bearer is read case-insensitively', bearerKey(`bearer ${k.key}`) === k.key);
    check('anything but one well-formed key is refused', bearerKey(`Bearer ${k.key} extra`) === null && bearerKey('Bearer jt_short') === null && bearerKey(`Basic ${k.key}`) === null && bearerKey(null) === null);
    check('a key name is cleaned and capped', cleanKeyName('  My\u0007 Mac  ') === 'My Mac' && cleanKeyName('') === 'AI tools' && cleanKeyName('x'.repeat(99)).length === 60);
  }

  // -----------------------------------------------------------------------
  section('MCP protocol');
  {
    type Ctx = { n: number };
    const server: ServerDef<Ctx> = {
      name: 't', title: 'T', version: '1', instructions: 'hi',
      tools: [
        { name: 'echo', title: 'Echo', description: 'echo', inputSchema: { type: 'object' }, run: async (a, c) => jsonResult({ a, n: c.n }) },
        { name: 'nope', title: 'Nope', description: 'fails', inputSchema: { type: 'object' }, run: async () => { throw new ToolError('told you'); } },
        { name: 'boom', title: 'Boom', description: 'crashes', inputSchema: { type: 'object' }, run: async () => { throw new Error('secret internals'); } },
      ],
      prompts: [{ name: 'p', title: 'P', description: 'd', render: (a) => `hello ${a.who}` }],
    };
    const call = (method: string, params: unknown = {}, id: number | string = 1) => handleMessage(server, { jsonrpc: '2.0', id, method, params }, { n: 7 });
    const init = (await call('initialize', { protocolVersion: '2025-06-18' })) as { result: { protocolVersion: string; instructions: string; capabilities: object } };
    check('initialize echoes a version it speaks', init.result.protocolVersion === '2025-06-18');
    const odd = (await call('initialize', { protocolVersion: '1999-01-01' })) as { result: { protocolVersion: string } };
    check('an unknown version gets our newest', odd.result.protocolVersion === PROTOCOL_VERSIONS[0]);
    check('initialize carries the instructions', init.result.instructions === 'hi');
    check('a notification gets no reply', (await handleMessage(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, { n: 0 })) === null);
    const disc = (await call('server/discover')) as { error?: { code: number } };
    check('server/discover is "method not found", so newer clients fall back to initialize', disc.error?.code === -32601);
    const list = (await call('tools/list')) as { result: { tools: { name: string }[] } };
    check('tools/list never leaks the run function', list.result.tools.every((t) => !('run' in t)));
    const echo = (await call('tools/call', { name: 'echo', arguments: { x: 1 } })) as { result: { content: { text: string }[] } };
    check('tools/call runs with arguments and context', JSON.parse(echo.result.content[0].text).n === 7 && JSON.parse(echo.result.content[0].text).a.x === 1);
    const nope = (await call('tools/call', { name: 'nope' })) as { result: { isError: boolean; content: { text: string }[] } };
    check('a ToolError is a result the model can read', nope.result.isError === true && nope.result.content[0].text === 'told you');
    const boom = (await call('tools/call', { name: 'boom' })) as { result: { isError: boolean; content: { text: string }[] } };
    check('an unexpected failure never leaks its message', boom.result.isError && !boom.result.content[0].text.includes('secret'));
    const unknown = (await call('tools/call', { name: 'missing' })) as { error?: { code: number } };
    check('an unknown tool is invalid params', unknown.error?.code === -32602);
    const badArgs = (await call('tools/call', { name: 'echo', arguments: [1, 2] })) as { error?: { code: number } };
    check('array arguments are refused', badArgs.error?.code === -32602);
    const prompt = (await call('prompts/get', { name: 'p', arguments: { who: 'you' } })) as { result: { messages: { content: { text: string } }[] } };
    check('prompts/get renders the prompt', prompt.result.messages[0].content.text === 'hello you');
    const batch = await handleBody(server, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }], { n: 0 });
    check('a batch answers requests and skips notifications', batch.status === 200 && Array.isArray((batch as { json: unknown[] }).json) && (batch as { json: unknown[] }).json.length === 1);
    check('a body of only notifications is a 202', (await handleBody(server, { jsonrpc: '2.0', method: 'notifications/x' }, { n: 0 })).status === 202);
    check('not JSON-RPC 2.0 is an invalid request', ((await handleMessage(server, { id: 1, method: 'ping' }, { n: 0 })) as { error?: { code: number } }).error?.code === -32600);
    check('errorResult marks isError', errorResult('x').isError === true);

    // The real server, as clients will see it.
    const names = JOB_TRACKER_SERVER.tools.map((t) => t.name);
    check('tool names are unique', new Set(names).size === names.length);
    check('tool names fit every client ([A-Za-z0-9_.-], 1–64)', names.every((n) => /^[A-Za-z0-9_.-]{1,64}$/.test(n)));
    check('every tool takes an object', JOB_TRACKER_SERVER.tools.every((t) => t.inputSchema.type === 'object'));
    check('every property name fits Claude Code', JOB_TRACKER_SERVER.tools.every((t) => Object.keys((t.inputSchema.properties ?? {}) as object).every((k) => /^[A-Za-z0-9_.-]{1,64}$/.test(k))));
    check('descriptions fit the 2,048-character cut', JOB_TRACKER_SERVER.tools.every((t) => t.description.length <= 2048) && INSTRUCTIONS.length <= 2048);
    check('every tool says whether it only reads', JOB_TRACKER_SERVER.tools.every((t) => typeof t.annotations?.readOnlyHint === 'boolean'));
    check('no tool deletes anything', JOB_TRACKER_SERVER.tools.every((t) => t.annotations?.destructiveHint !== true));
    const mentioned = [...new Set(PLAYBOOK.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => /^(get|search|read|add|list|update|log|check|evaluate)_/.test(w));
    const connectorOnly = new Set(['search_job_boards', 'read_job_posting', 'check_job_hunt_setup']);
    const missing = mentioned.filter((m) => !names.includes(m) && !connectorOnly.has(m));
    check('every tool the playbook names exists', missing.length === 0, missing.join(', '));
    check('the connector searches exactly the boards the tracker plans', JSON.stringify([...CONNECTOR_BOARDS].sort()) === JSON.stringify([...BOARD_IDS].sort()));
  }

  // -----------------------------------------------------------------------
  section('Job boards: planning');
  {
    const plans = planBoardSearch({ role: 'Software Engineer', location: 'Bengaluru', postedWithinDays: 14, minYears: 0 });
    const url = (b: string) => new URL(plans.find((p) => p.board === b)!.url);
    check('one page per board', plans.length === BOARD_IDS.length);
    check('LinkedIn: the public search page, past 14 days, entry level', url('linkedin').pathname === '/jobs/search' && url('linkedin').searchParams.get('f_TPR') === `r${14 * 86400}` && url('linkedin').searchParams.get('f_E') === '1,2');
    check('LinkedIn: one page only, never paged', url('linkedin').searchParams.get('pageNum') === '0');
    check('Naukri: role and city in the path', url('naukri').pathname === '/software-engineer-jobs-in-bengaluru' && url('naukri').searchParams.get('jobAge') === '14');
    check('Naukri waits for its results to render', Boolean(plans.find((p) => p.board === 'naukri')!.waitFor));
    check('Wellfound spells Bengaluru "bangalore"', url('wellfound').pathname === '/role/l/software-engineer/bangalore');
    check('Wellfound without a city searches India', new URL(planBoardSearch({ role: 'SDE', location: 'India', postedWithinDays: 7, minYears: null }, ['wellfound'])[0].url).pathname.endsWith('/india'));
    check('Glassdoor gets its canonical search address, spans and all', url('glassdoor').pathname === '/Job/bangalore-software-engineer-jobs-SRCH_IL.0,9_IC2940587_KO10,27.htm' && url('glassdoor').searchParams.get('fromAge') === '14');
    check('Glassdoor without a known city searches India', new URL(planBoardSearch({ role: 'SDE', location: 'Pune', postedWithinDays: 7, minYears: null }, ['glassdoor'])[0].url).pathname === '/Job/india-sde-jobs-SRCH_IL.0,5_IN115_KO6,9.htm');
    check('boards with cards carry an extraction schema', plans.filter((p) => p.extract).map((p) => p.board).sort().join() === 'foundit,glassdoor,linkedin,naukri');
  }

  section('Job boards: reading pages');
  {
    const li = readCards('linkedin', [
      { urn: 'urn:li:jobPosting:4471646111', title: 'Software Development Engineer II, Seller Partner Services Tech', company: 'Amazon', location: 'Bengaluru, Karnataka, India', posted: '2026-09-24', age: '4 days ago' },
      { urn: 'urn:li:jobPosting:4471646111', title: 'dup', company: 'Amazon' },
      { title: '' },
    ], TODAY);
    check('LinkedIn: a posting link from the job id', li[0]?.url === 'https://www.linkedin.com/jobs/view/4471646111/');
    check('LinkedIn: the exact posted date wins over "4 days ago"', li[0]?.postedOn === '2026-09-24');
    check('LinkedIn: duplicate and empty cards dropped', li.length === 1);
    const nk = readCards('naukri', [
      { jobId: '080426034452', title: 'SDE -2', href: 'https://www.naukri.com/job-listings-sde-2-deloitte-us-india-offices-bengaluru-0-to-5-years-080426034452', company: 'Deloitte US-India Offices', experience: '0-5 Yrs ', location: 'Bengaluru, Delhi / NCR ', salary: 'Not disclosed', age: '2 weeks ago', skills: [{ t: 'Java' }, { t: 'Spring' }] },
    ], TODAY);
    check('Naukri: experience normalised', nk[0]?.experience === '0–5 yrs', nk[0]?.experience);
    check('Naukri: "Not disclosed" is not a salary', nk[0]?.salary === '');
    check('Naukri: "2 weeks ago" is a date', nk[0]?.postedOn === '2026-09-15');
    check('Naukri: skills reach the snippet', nk[0]?.snippet.includes('Java, Spring') === true);
    const fi = readCards('foundit', [{ jobId: '69270495', title: 'Platform Software Engineer 2', company: 'Oracle', details: [{ t: 'Fresher' }], location: 'Bengaluru, India', age: 'Posted 5 hours ago' }], TODAY);
    check('foundit: a posting link built from the id', fi[0]?.url === 'https://www.foundit.in/job/platform-software-engineer-2-oracle-69270495');
    check('foundit: "Fresher" is zero years', fi[0]?.experience === '0 yrs');
    check('foundit: hours ago is today', fi[0]?.postedOn === TODAY);
    const gd = readCards('glassdoor', [{ jobId: '1010128416551', title: 'Platform Engineer - AI Trainer', href: 'https://www.glassdoor.co.in/job-listing/platform-engineer-ai-trainer-dataannotation-JV_KO0,28_KE29,43.htm?jl=1010128416551', company: 'DataAnnotation', location: 'Haryana', salary: '₹7,195.34 - ₹14,390.68 Per hour', age: '30d+' }], TODAY);
    check('Glassdoor: the listing link is kept', gd[0]?.url.includes('jl=1010128416551') === true);
    check('Glassdoor: "30d+" is a date', gd[0]?.postedOn === '2026-08-30');
    const wf = readWellfound(
      '## [ZenTrades](https://wellfound.com/company/zentrades-3)\nActively Hiring\n\n[Senior Software Engineer](https://wellfound.com/jobs/4735247-senior-software-engineer)Full-time\nIn office • Bengaluru\n2 years of exp\n1 week ago\n1 week agoSave\nApply\n## [Boom](https://wellfound.com/company/boom-app)\n[Software Engineer](https://wellfound.com/jobs/4716782-software-engineer)Full-time\n$120k – $200k • 0.01% – 0.15%\nAustin\n2 weeks ago\n',
      TODAY,
    );
    check('Wellfound: each job takes the company heading above it', wf.map((w) => w.company).join() === 'ZenTrades,Boom');
    check('Wellfound: place, experience, pay and age', wf[0]?.location === 'In office • Bengaluru' && wf[0]?.experience === '2+ yrs' && wf[1]?.salary.startsWith('$120k') && wf[0]?.postedOn === '2026-09-22');
    check('Wellfound: US postings do not fit a Bengaluru search', !placeFits(wf[1].location, 'Bengaluru') && placeFits(wf[0].location, 'Bengaluru'));
    check('an empty location is kept', placeFits('', 'Bengaluru'));
    check('accents, old names and states are still India', ['Hyderābād', 'Calcutta', 'Haryana', 'Cochin', 'Bombay'].every((l) => placeFits(l, 'India')));
    check('Glassdoor\'s "Humans only" page is a bot check', blockedReason('glassdoor', '# Humans only\nGlassdoor has been built on…' + ' '.repeat(300), 200)?.includes('bot check') === true);
    check('a LinkedIn sign-in wall is blocked, not empty', blockedReason('linkedin', 'Sign in to view more jobs. Join LinkedIn '.repeat(10), 200)?.includes('sign in') === true);
    check('an HTTP 429 is a refusal', blockedReason('naukri', 'x'.repeat(500), 429)?.includes('429') === true);

    const merged = parseCrawl(
      [
        { board: 'linkedin', url: 'https://www.linkedin.com/jobs/search', markdown: 'x'.repeat(400), items: [
          { urn: 'urn:li:jobPosting:1111111', title: 'Software Engineer I', company: 'A', location: 'Bengaluru', posted: '2026-09-28' },
          { urn: 'urn:li:jobPosting:2222222', title: 'Staff Software Engineer', company: 'B', location: 'Bengaluru', posted: '2026-09-28' },
          { urn: 'urn:li:jobPosting:3333333', title: 'Software Engineer', company: 'C', location: 'Bengaluru', posted: '2026-06-01' },
        ], status: 200 },
        { board: 'glassdoor', url: 'https://www.glassdoor.co.in/Job/jobs.htm', markdown: '# Humans only\n' + 'x'.repeat(300), items: [], status: 200 },
        { board: 'naukri', url: 'https://www.naukri.com/x', markdown: '', items: null, status: null, error: 'the page took too long to load' },
      ],
      { seniority: 'entry', postedWithinDays: 14, location: 'Bengaluru' },
      [job({ id: 'known', key: 'linkedin:1111111' })],
      TODAY,
    );
    check('entry level drops Staff; recency drops June', merged.listings.length === 1 && merged.listings[0].company === 'A', JSON.stringify(merged.listings.map((l) => l.company)));
    check('an already tracked posting is marked, not dropped', merged.listings[0]?.alreadyTracked === true && merged.listings[0]?.existingId === 'known');
    const status = Object.fromEntries(merged.boards.map((b) => [b.board, b.status]));
    check('blocked and failed boards are reported as such', status.glassdoor === 'blocked' && status.naukri === 'failed' && status.linkedin === 'ok', JSON.stringify(status));
  }

  section('Job boards: text');
  {
    check('"24h" is today', postedFromText('24h', TODAY) === TODAY);
    check('"5d" is five days back', postedFromText('5d', TODAY) === '2026-09-24');
    check('"Posted 11 Days Ago"', postedFromText('Posted 11 Days Ago', TODAY) === '2026-09-18');
    check('"yesterday"', postedFromText('Posted yesterday', TODAY) === '2026-09-28');
    check('experience ranges', experienceFromText('2 to 7 years') === '2–7 yrs' && experienceFromText('0 - 2 Yrs') === '0–2 yrs' && experienceFromText('4+ years') === '4+ yrs');
    check('salary as written', salaryFromText('CTC ₹19L - ₹23L / yr') === '₹19L - ₹23L / yr' && salaryFromText('3-8 Lacs PA') === '3-8 Lacs PA');
    check('seniority from the title first', seniorityOf('Senior Software Engineer', '0–2 yrs') === 'senior' && seniorityOf('SDE 1', '') === 'entry' && seniorityOf('Software Engineer Intern', '') === 'intern');
    check('bank and exec titles are senior', ['Vice President, Software Engineering', 'Backend Developer, AVP', 'Dir, Software Engineering'].every((t) => seniorityOf(t, '') === 'senior'));
    check('seniority from experience when the title says nothing', seniorityOf('Software Engineer', '0–2 yrs') === 'entry' && seniorityOf('Software Engineer', '5–8 yrs') === 'senior');
    check('an entry search keeps mid roles that start at 2 years', keepForLevel({ seniority: 'mid', experience: '2–4 yrs' }, 'entry') && !keepForLevel({ seniority: 'mid', experience: '3–5 yrs' }, 'entry'));
  }


  // -----------------------------------------------------------------------
  section('Hardening (from review)');
  {
    check('"constructor" is not a status', coerceStatus('constructor') === null && coerceStatus('toString') === null);
    check('"constructor" is not a source', coerceSource('__proto__') === null && coerceSource('constructor') === null);
    check('"constructor" is not an event kind', !parseEventInput({ kind: 'constructor' }).ok && !parseEventInput({ kind: 'hasOwnProperty' }).ok);
    let threw = false;
    try {
      titleMatches('Constructor Engineer', 'constructor engineer');
    } catch {
      threw = true;
    }
    check('a role containing "constructor" searches instead of throwing', !threw);

    const big = await handleBody(JOB_TRACKER_SERVER, Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })), {} as never);
    check('an oversized batch is refused whole', big.status === 400);

    let t = Date.now();
    readPostingPage('https://example.com/job', '!['.repeat(100_000), 200);
    check('a page of broken image markup parses in well under a second', Date.now() - t < 1000, `${Date.now() - t}ms`);
    t = Date.now();
    parseCrawl([{ board: 'linkedin', url: 'https://www.linkedin.com/jobs/search', markdown: '[x](https://www.linkedin.com/jobs/view/4471646111/) '.repeat(20_000), items: null, status: 200 }], { seniority: 'any', postedWithinDays: 0, location: '' }, []);
    check('a page repeating one link a million characters long stays linear', Date.now() - t < 1000, `${Date.now() - t}ms`);

    const refused = async (u: string, boardsOnly = false) => Boolean(await refuseUrl(u, { boardsOnly }));
    check('board searches open only the five boards', !(await refused('https://www.naukri.com/x', true)) && (await refused('https://example.com/x', true)));
    check('the crawler never opens this computer', (await refused('http://localhost:3000/')) && (await refused('http://127.0.0.1:11235/health')) && (await refused('http://[::1]/')));
    check('or the local network', (await refused('http://192.168.1.1/')) && (await refused('http://10.0.0.8/')) && (await refused('http://host.docker.internal/')) && (await refused('http://printer.local/')));
    check('or a VPN\'s private range', await refused('http://198.18.24.247/'));
    check('or anything that is not the web', (await refused('file:///etc/passwd')) && (await refused('ftp://example.com/')) && (await refused('https://user:pw@example.com/')));
  }

  section('Class merging keeps the type scale');
  {
    check('a custom size survives a colour (cn)', cn('text-micro', 'text-ink-2') === 'text-micro text-ink-2' && cn('text-display', 'text-ink') === 'text-display text-ink');
    check('two sizes still resolve to the last', cn('text-micro', 'text-xs') === 'text-xs');
    check('clampInt bounds and falls back', clampInt('7', 1, 5, 3) === 5 && clampInt('x', 1, 5, 3) === 3 && clampInt(2.6, 1, 5, 3) === 3);
  }

  // -----------------------------------------------------------------------
  section('Company career sites');
  {
    check('every listed site is complete', CAREER_SITES.every((s) => s.name && (s.ats === 'workday' ? s.host.endsWith('.myworkdayjobs.com') && s.tenant && s.site : s.slug)));
    check('no company is listed twice', new Set(CAREER_SITES.map((s) => s.name.toLowerCase())).size === CAREER_SITES.length);
    check('the list is the verified one, not a stub', CAREER_SITES.length >= 60, String(CAREER_SITES.length));
    check('"SDE" finds "Software Development Engineer"', titleMatches('Software Development Engineer II', 'SDE 1'));
    check('"engineer" finds "Developer"', titleMatches('Backend Developer', 'Backend Engineer'));
    check('"AI engineer" does not match "Airflow"', !titleMatches('Airflow Platform Engineer', 'AI Engineer'));
    check('all query words must match', !titleMatches('Product Manager', 'Software Engineer'));
    check('India accepts any Indian city', locationMatches('Hyderabad, Telangana', false, 'India'));
    check('Bengaluru accepts Bangalore', locationMatches('Bangalore, IN', false, 'Bengaluru'));
    check('a city search refuses another city', !locationMatches('Pune', false, 'Bengaluru'));
    check('remote accepts remote India, not remote US', locationMatches('Remote - India', true, 'Remote') && !locationMatches('Remote - US', true, 'Remote'));
    check('no place in the query filters nothing', locationMatches('Austin, TX', false, 'anywhere you like'));
    check('Workday "Posted 30+ Days Ago"', workdayPosted('Posted 30+ Days Ago', TODAY) === '2026-08-30' && workdayPosted('Posted Today', TODAY) === TODAY);
    check('target companies split from free text', companiesFrom('Stripe, Razorpay\nCRED; x').join() === 'Stripe,Razorpay,CRED');
  }

  // -----------------------------------------------------------------------
  section('Jobs: the rubric');
  {
    const all = (n: number) => ({ skills: n, level: n, location: n, pay: n, role: n });
    check('all fives is 100', computeMatch(all(5)) === 100);
    check('all threes is 60', computeMatch(all(3)) === 60);
    check('unknown pay counts as the middle', computeMatch({ ...all(5), pay: null }) === computeMatch({ ...all(5), pay: 3 }));
    const typical = { skills: 4, level: 5, location: 5, pay: null, role: 4 };
    check('the weights are 30/25/15/15/15', computeMatch(typical) === 85, String(computeMatch(typical)));
    check('a red flag costs 10', computeMatch(typical, ['Vague description']) === 75);
    check('only three red flags count', computeMatch(all(5), ['Stale posting', 'Reposted', 'Vague description', 'Recent layoffs']) === 70);
    check('a hard stop caps the match at 50', computeMatch(all(5), [], ['Service bond']) === 50 && computeMatch(all(2), [], ['Service bond']) === 40);
    check('the match never goes below 0', computeMatch(all(1), ['Stale posting', 'Reposted', 'Vague description']) === 0);

    check('80 on a full read is Apply', verdictFor({ match: 80, depth: 'Full' }) === 'Apply');
    check('79 is Consider', verdictFor({ match: 79, depth: 'Full' }) === 'Consider');
    check('69 is Skip', verdictFor({ match: 69, depth: 'Full' }) === 'Skip');
    check('a hard stop is Skip at any match', verdictFor({ match: 100, depth: 'Full', hardStops: ['Avoided company'] }) === 'Skip');
    check('a suspicious posting is Research first, however well it scores', verdictFor({ match: 95, depth: 'Full', legitimacy: 'Suspicious' }) === 'Research first');
    check('a quick look never says Apply', verdictFor({ match: 100, depth: 'Quick' }) === 'Research first');
    check('a middling quick look is Consider', verdictFor({ match: 65, depth: 'Quick' }) === 'Consider');
    check('a weak quick look is Skip', verdictFor({ match: 59, depth: 'Quick' }) === 'Skip');

    check('level 5 and 4 are on-level', levelFitFor(5) === 'On-level' && levelFitFor(4) === 'On-level');
    check('level 3 is a stretch', levelFitFor(3) === 'Stretch');
    check('level 2 is over-level', levelFitFor(2) === 'Over-level' && levelFitFor(null) === null);

    check('a posting 46 days old is stale', systemRedFlags({ postedOn: '2026-08-14' }, TODAY).join() === 'Stale posting');
    check('45 days is not yet', systemRedFlags({ postedOn: '2026-08-15' }, TODAY).length === 0 && systemRedFlags({ postedOn: null }, TODAY).length === 0);
    const j = judge(
      { depth: 'Full', scores: typical, hardStops: [], redFlags: ['Vague description'], legitimacy: 'High' },
      { postedOn: '2026-08-01', keptFlags: ['Reposted'], today: TODAY },
    );
    check('judging adds what the tracker sees and keeps what it found', j.redFlags.join() === 'Stale posting,Reposted,Vague description', j.redFlags.join());
    check('and scores the lot', j.match === 55 && j.verdict === 'Skip' && j.levelFit === 'On-level', `${j.match} ${j.verdict}`);

    const line = formatScores(typical);
    check('scores read as one line in Notion', line === 'Skills 4 · Level 5 · Location 5 · Pay ? · Role 4', line);
    check('and come back the same', JSON.stringify(parseScores(line)) === JSON.stringify(typical));
    check('text with no scores is no scores', parseScores('') === null && parseScores('just a note') === null);
  }

  section('Jobs: evaluation input');
  {
    const quick = parseEvaluation({ scores: { skills: '4', level: 5, location: 4.6, role: 4 } }, { depth: 'Quick' });
    check('a quick look needs only the four listing scores', quick.ok, quick.ok ? '' : quick.error);
    if (quick.ok) {
      check('numbers arrive as strings and decimals too', quick.value.scores.skills === 4 && quick.value.scores.location === 5);
      check('missing pay is unknown', quick.value.scores.pay === null && quick.value.depth === 'Quick');
    }
    const noLevel = parseEvaluation({ scores: { skills: 4, location: 4, role: 4 } }, { depth: 'Quick' });
    check('a missing score says which', !noLevel.ok && noLevel.error.includes('scores.level'));
    check('a score of 6 is refused', !parseEvaluation({ scores: { skills: 6, level: 5, location: 4, role: 4 } }, { depth: 'Quick' }).ok);
    check('"unknown" pay is null, not an error', (() => { const r = parseEvaluation({ scores: { skills: 4, level: 5, location: 4, role: 4, pay: 'unknown' } }, { depth: 'Quick' }); return r.ok && r.value.scores.pay === null; })());
    const syn = parseEvaluation(
      { scores: { skills: 4, level: 5, location: 4, role: 4 }, hard_stops: ['experience'], red_flags: ['contract to hire', 'Reposted'], role_family: 'back end' },
      { depth: 'Quick' },
    );
    check('hard stops and red flags take synonyms', syn.ok && syn.value.hardStops.join() === 'Needs more experience' && syn.value.redFlags.join() === 'Staffing or contract,Reposted', syn.ok ? syn.value.redFlags.join() : syn.error);
    check('role families take synonyms', syn.ok && syn.value.roleFamily === 'Backend');
    check('an unknown role family is Other', (() => { const r = parseEvaluation({ scores: { skills: 4, level: 5, location: 4, role: 4 }, role_family: 'astronaut' }, { depth: 'Quick' }); return r.ok && r.value.roleFamily === 'Other'; })());
    const bad = parseEvaluation({ scores: { skills: 4, level: 5, location: 4, role: 4 }, hard_stops: ['bad vibes'] }, { depth: 'Quick' });
    check('an unknown hard stop is refused with the list', !bad.ok && bad.error.includes('Service bond'));
    check('"constructor" is not a hard stop', !parseEvaluation({ scores: { skills: 4, level: 5, location: 4, role: 4 }, hard_stops: ['constructor'] }, { depth: 'Quick' }).ok);
    const scores = { skills: 4, level: 5, location: 4, role: 4 };
    check('a full evaluation needs legitimacy', !parseEvaluation({ scores, requirements: [{ requirement: 'Go', weight: 'must', match: 'strong', evidence: 'x' }] }, { depth: 'Full' }).ok);
    check('a full evaluation needs requirements', !parseEvaluation({ scores, legitimacy: 'High' }, { depth: 'Full' }).ok);
    const full = parseEvaluation(
      { scores, legitimacy: 'high', requirements: [{ requirement: 'Go', weight: 'required', match: 'gap', evidence: 'not on the resume' }], posting_text: 'p'.repeat(40_000) },
      { depth: 'Full' },
    );
    check('a full evaluation with both is accepted', full.ok, full.ok ? '' : full.error);
    if (full.ok) {
      check('requirement words take synonyms', full.value.requirements[0].weight === 'Must' && full.value.requirements[0].match === 'Missing');
      check('the posting is capped', full.value.posting.length <= 30_000);
      check('fields not sent stay unchanged (null, not empty)', full.value.fit === null && full.value.howToApply === null);
    }
    check('depth "quick" is honoured on evaluate_job', (() => { const r = parseEvaluation({ depth: 'quick', scores }, { depth: 'Full' }); return r.ok && r.value.depth === 'Quick'; })());
    const nulls = parseEvaluation({ scores, why_it_fits: null, how_to_apply: '   ' }, { depth: 'Quick' });
    check('null or blank text is "not given", never "erase it"', nulls.ok && nulls.value.fit === null && nulls.value.howToApply === null);
    const objects = parseEvaluation({ scores, pay_notes: [{ text: 'x' }, 'real note'], skill_gaps: [{ name: 'Go' }, 'Java'], score_notes: { skills: { a: 1 } } }, { depth: 'Quick' });
    check('objects in a list are dropped, not saved as "[object Object]"', objects.ok && objects.value.payNotes.join() === 'real note' && objects.value.skillGaps.join() === 'Java' && !objects.value.notes.skills);
  }

  section('Jobs: the evaluation report');
  {
    const report: EvaluationReport = {
      summary: 'Strong backend fit; Java is the gap.',
      byline: 'Rubric v1 · Full evaluation · 2026-09-29 · by Claude Code',
      scores: { skills: 4, level: 5, location: 5, pay: null, role: 4 },
      notes: { skills: 'Node and Postgres map', pay: 'not in the posting' },
      requirements: [
        { requirement: 'REST APIs', weight: 'Must', match: 'Strong', evidence: 'built the webhook service' },
        { requirement: 'Java', weight: 'Core', match: 'Missing', evidence: 'not on the resume' },
      ],
      levelStrategy: 'On-level.\n\nLead with shipped services.',
      payNotes: ['Posted: "₹14-20 LPA"'],
      legitimacySignals: ['Posted 3 days ago', 'On the employer site'],
      resumeEdits: ['Lead with the rate-limiter'],
      keywords: ['REST', 'SQL'],
      posting: 'First paragraph.\n\nSecond paragraph.',
    };
    const blocks = reportBlocks(report);
    // Notion reads rich text back as plain_text; the table's rows come separately.
    const readBack = (b: Record<string, unknown>, i: number) => {
      const type = b.type as string;
      const inner = b[type] as { rich_text?: { text: { content: string } }[]; children?: unknown[] };
      return { id: `b${i}`, type, has_children: type === 'table', [type]: { ...inner, rich_text: inner.rich_text?.map((r) => ({ plain_text: r.text.content })) } };
    };
    const table = blocks.find((b) => b.type === 'table') as { table: { children: { table_row: { cells: { text: { content: string } }[][] } }[] } };
    const rows = table.table.children.map((r) => ({ type: 'table_row', table_row: { cells: r.table_row.cells.map((c) => c.map((t) => ({ plain_text: t.text.content }))) } }));
    const back = parseReport(blocks.map(readBack), (id) => (id === `b${blocks.indexOf(table)}` ? rows : undefined));
    check('the report comes back as it went in', JSON.stringify(back) === JSON.stringify({ ...report }), JSON.stringify(back).slice(0, 300));
    check('empty sections are left out, heading and all', !reportBlocks({ ...report, payNotes: [] }).some((b) => b.type === 'heading_2' && b.heading_2.rich_text[0].text.content === 'Pay'));
    const huge = reportBlocks({ ...report, posting: Array.from({ length: 300 }, (_, i) => `Paragraph ${i} `.repeat(40)).join('\n\n') });
    check('a long posting still fits one Notion create', huge.length <= 100, String(huge.length));
    check('and says it was cut', JSON.stringify(huge[huge.length - 1]).includes('did not fit'));
    check('no block holds more than Notion allows', huge.every((b) => (b[b.type]?.rich_text ?? []).every((r: { text: { content: string } }) => r.text.content.length <= 2000)));
    check('a long paragraph stays whole, and its runs fit Notion', (() => { const c = chunkText('a'.repeat(5000)); return c.length === 1 && c[0].length === 5000 && textRuns(c[0]).every((r) => r.length <= 2000); })());
    check('short paragraphs are kept together', chunkText('one\n\ntwo\n\nthree').length === 1);
    const long = `${'word '.repeat(499)}end`;
    const withLong = reportBlocks({ ...report, posting: `${long}\n\nshort one` });
    const longBack = parseReport(withLong.map(readBack), () => rows);
    check('a 2,500-character paragraph comes back word for word', longBack.posting === `${long}\n\nshort one`, `${longBack.posting.length}`);
    const emoji = `${'a'.repeat(1999)}😀b`;
    check('a run never splits an emoji', textRuns(emoji).join('') === emoji && textRuns(emoji).every((r) => !/[\ud800-\udbff]$/.test(r)));
    check('the cut note is not read as part of the posting', !parseReport(huge.map(readBack), () => rows).posting.includes('did not fit'));
    const rubricSummary = parseReport(reportBlocks({ ...report, summary: 'Rubric v1 aside, this is a strong fit.' }).map(readBack), () => rows);
    check('a summary that starts "Rubric v1" stays the summary', rubricSummary.summary === 'Rubric v1 aside, this is a strong fit.' && rubricSummary.byline === report.byline);
    check('a page id comes out of a Notion URL', pageIdFromUrl('https://www.notion.so/Evaluation-0123456789abcdef0123456789abcdef') === '0123456789abcdef0123456789abcdef' && pageIdFromUrl('not a url') === null);
  }

  section('Jobs: reposts');
  {
    const theirs = { key: 'linkedin:4471646111', jobUrl: 'https://www.linkedin.com/jobs/view/4471646111/', applyUrl: null, source: 'LinkedIn' as const, foundOn: '2026-09-10' };
    const again = { jobUrl: 'https://www.linkedin.com/jobs/view/4480000000/', applyUrl: null, source: 'LinkedIn' as const };
    check('a new posting id on the same board, another day, is a repost', isRepost(again, theirs, TODAY));
    check('the same day is two openings, not a repost', !isRepost(again, { ...theirs, foundOn: TODAY }, TODAY));
    check('another board is a cross-listing, not a repost', !isRepost({ ...again, source: 'Naukri' }, theirs, TODAY));
    check('past 90 days it is a new job', !isRepost(again, { ...theirs, foundOn: '2026-06-01' }, TODAY));
    check('cleaned URLs are not ids to compare', !isRepost({ ...again, jobUrl: 'https://careers.acme.com/jobs/2' }, { ...theirs, key: 'url:careers.acme.com/jobs/1', jobUrl: 'https://careers.acme.com/jobs/1' }, TODAY));
  }

  section('Jobs: judgment in Notion');
  {
    const mapped = mapJob({
      id: 'p', url: 'u', created_time: 'c',
      properties: {
        [P.job.role]: { title: [{ plain_text: 'X' }] },
        [P.job.verdict]: { select: { name: 'Apply' } },
        [P.job.levelFit]: { select: { name: 'Maybe' } },
        [P.job.hardStops]: { multi_select: [{ name: 'Service bond' }, { name: 'Made up in Notion' }] },
        [P.job.scores]: { rich_text: [{ plain_text: 'Skills 4 · Level 5 · Location 5 · Pay ? · Role 4' }] },
        [P.job.evaluation]: { select: { name: 'Full' } },
        [P.job.report]: { url: 'https://www.notion.so/r-0123456789abcdef0123456789abcdef' },
      },
    });
    check('the judgment reads back', mapped.verdict === 'Apply' && mapped.evaluation === 'Full' && mapped.scores?.level === 5 && mapped.reportUrl !== null);
    check('an option added by hand in Notion reads as unset', mapped.levelFit === null && mapped.hardStops.join() === 'Service bond');
    check('a job saved before the rubric reads as not evaluated', (() => { const m = mapJob({ id: 'q', properties: {} }); return m.verdict === null && m.scores === null && m.hardStops.length === 0; })());
    const props = jobProperties({ verdict: 'Skip', hardStops: ['Service bond'], scores: { skills: 3, level: 3, location: 3, pay: null, role: 3 }, reportUrl: null });
    check('the judgment writes as Notion properties', (props[P.job.verdict] as { select: { name: string } }).select.name === 'Skip' && (props[P.job.hardStops] as { multi_select: { name: string }[] }).multi_select[0].name === 'Service bond');
    check('scores write as their one line', (props[P.job.scores] as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content.startsWith('Skills 3'));

    const wanted = jobsProperties();
    const diff = missingProperties({ [P.job.role]: { type: 'title' }, [P.job.status]: { type: 'select' }, Custom: { type: 'rich_text' } }, wanted);
    check('a migration adds only what is missing', !(P.job.status in diff.missing) && P.job.verdict in diff.missing && P.job.scores in diff.missing);
    check('it never adds a second title', Object.values(diff.missing).every((d) => !('title' in (d as object))));
    check('and never touches a column someone added', !('Custom' in diff.missing) && diff.conflicts.length === 0);
    const asRead = Object.fromEntries(Object.entries(wanted).map(([k, v]) => [k, { type: Object.keys(v as object)[0] }]));
    check('nothing is missing from a current database', Object.keys(missingProperties(asRead, wanted).missing).length === 0);
    const clash = missingProperties({ [P.job.report]: { type: 'files' } }, wanted);
    check('a column of ours made as another kind is a conflict, not a success', clash.conflicts[0]?.name === P.job.report && !(P.job.report in clash.missing));
    check('an open-ended multi-select is added without an options list', JSON.stringify(diff.missing[P.job.skillGaps]) === '{"multi_select":{}}');
    check('a fixed one keeps its options', Array.isArray((diff.missing[P.job.hardStops] as { multi_select: { options: unknown[] } }).multi_select.options));
  }

  section('Jobs in Notion (fake Notion)');
  {
    const ds = '11111111-1111-1111-1111-111111111111';
    const pageId = '22222222-2222-2222-2222-222222222222';
    const tenant = (token: string): Tenant => ({
      userId: '33333333-3333-3333-3333-333333333333', username: 'tester', token, areasDs: 'a', topicsDs: 't', tasksDs: 'k',
      dailyDs: null, jobsDs: ds, jobsProfileDs: null, jobsProfilePageId: null, jobsSchema: 2, parentPageId: null,
    });
    const page = (props: Record<string, unknown>, parent = ds) => ({
      object: 'page', id: pageId, url: 'https://www.notion.so/x', created_time: '2026-09-20T00:00:00.000Z',
      parent: { type: 'data_source_id', data_source_id: parent, database_id: 'db' },
      properties: {
        [P.job.role]: { title: [{ plain_text: 'Software Engineer' }] },
        [P.job.company]: { rich_text: [{ plain_text: 'Acme' }] },
        [P.job.status]: { select: { name: 'Shortlisted' } },
        [P.job.appliedOn]: { date: null },
        [P.job.heardBackOn]: { date: null },
        ...props,
      },
    });
    const realFetch = globalThis.fetch;
    let calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
    const fake = (respond: (method: string, url: string) => unknown) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify(respond(method, url)), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

    // No leases against a real database from here: .env.local may name one.
    const dbKeys = Object.keys(process.env).filter((k) => /DATABASE_URL|POSTGRES_URL/.test(k));
    const dbEnv = Object.fromEntries(dbKeys.map((k) => [k, process.env[k]]));
    for (const k of dbKeys) delete process.env[k];
    try {
      calls = [];
      globalThis.fetch = fake((m, u) => (u.includes('/blocks/') ? { object: 'list', results: [] } : m === 'PATCH' ? page({ [P.job.status]: { select: { name: 'Applied' } } }) : page({})));
      const updated = await updateJob(tenant('ntn_fake_update'), pageId, { status: 'Applied' }, { kind: 'You', name: 'tester' });
      const upd = calls.find((c) => c.method === 'PATCH' && c.url.includes('/pages/'))?.body?.properties as Record<string, { select?: { name: string }; date?: { start: string } }>;
      check('an update reads the page first, to check it is a job', calls[0]?.method === 'GET' && calls[0].url.includes(pageId));
      check('moving to Applied writes Status and stamps Applied On', upd?.[P.job.status]?.select?.name === 'Applied' && Boolean(upd?.[P.job.appliedOn]?.date?.start));
      check('every update stamps Last Update', Boolean(upd?.[P.job.lastUpdate]?.date?.start));
      const appended = calls.find((c) => c.url.includes('/blocks/'))?.body as { children?: { bulleted_list_item: { rich_text: { text: { content: string } }[] } }[] } | null;
      check('a status change adds a timeline line', appended?.children?.[0]?.bulleted_list_item.rich_text[0].text.content.includes('Shortlisted → Applied') === true);
      check('the updated job comes back', updated?.status === 'Applied');

      calls = [];
      globalThis.fetch = fake(() => page({}, '99999999-9999-9999-9999-999999999999'));
      const foreign = await updateJob(tenant('ntn_fake_foreign'), pageId, { status: 'Applied' }, { kind: 'AI', name: 'k' });
      check('a page from another database is refused', foreign === null && !calls.some((c) => c.method === 'PATCH'));

      calls = [];
      globalThis.fetch = fake((m, u) => (u.includes('/blocks/') ? { object: 'list', results: [] } : m === 'PATCH' ? page({ [P.job.status]: { select: { name: 'Interviewing' } } }) : page({ [P.job.status]: { select: { name: 'Applied' } }, [P.job.appliedOn]: { date: { start: '2026-09-10' } } })));
      const logged = await logJobEvent(tenant('ntn_fake_log'), pageId, { kind: 'interview', text: 'Round 1', date: '2026-09-28', moveStatus: true }, { kind: 'AI', name: 'Claude Code' });
      const lp = calls.find((c) => c.method === 'PATCH' && c.url.includes('/pages/'))?.body?.properties as Record<string, { select?: { name: string }; date?: { start: string } }>;
      check('an interview event moves the status', logged?.movedTo === 'Interviewing' && lp?.[P.job.status]?.select?.name === 'Interviewing');
      check('and stamps Heard Back On with the event date', lp?.[P.job.heardBackOn]?.date?.start === '2026-09-28');
      check('Applied On is left alone when already set', !(P.job.appliedOn in (lp ?? {})));
      const line = (calls.find((c) => c.url.includes('/blocks/'))?.body as { children: { bulleted_list_item: { rich_text: { text: { content: string } }[] } }[] }).children[0].bulleted_list_item.rich_text[0].text.content;
      check('the timeline line says what, when and who', line.startsWith('2026-09-28 · Interview — Round 1') && line.includes('Claude Code'), line);

      // A full evaluation: the report page first, then the judgment, then the timeline.
      const reportId = '44444444-4444-4444-4444-444444444444';
      const reportUrl = 'https://www.notion.so/Evaluation-44444444444444444444444444444444';
      calls = [];
      globalThis.fetch = fake((m, u) => {
        if (m === 'POST' && u.endsWith('/pages')) return { object: 'page', id: reportId, url: reportUrl };
        if (u.includes('/blocks/')) return { object: 'list', results: [] };
        if (m === 'PATCH') return page({ [P.job.verdict]: { select: { name: 'Apply' } }, [P.job.match]: { number: 85 } });
        return page({ [P.job.status]: { select: { name: 'Found' } } });
      });
      const ev = parseEvaluation(
        { scores: { skills: 4, level: 5, location: 5, role: 4 }, legitimacy: 'High', summary: 'Good fit', requirements: [{ requirement: 'REST', weight: 'must', match: 'strong', evidence: 'webhooks' }] },
        { depth: 'Full' },
      );
      const saved = ev.ok ? await saveEvaluation(tenant('ntn_fake_eval'), pageId, ev.value, { kind: 'AI', name: 'Claude Code' }) : null;
      const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pages'));
      const judged = calls.find((c) => c.method === 'PATCH' && c.url.includes(`/pages/${pageId}`))?.body?.properties as Record<string, { number?: number; select?: { name: string }; url?: string; rich_text?: { text: { content: string } }[] }>;
      check("a full evaluation saves its report as the job's own child page", (created?.body?.parent as { page_id?: string } | undefined)?.page_id === pageId);
      check('the tracker computes the match and verdict, not the tool', judged?.[P.job.match]?.number === 85 && judged?.[P.job.verdict]?.select?.name === 'Apply');
      check('the job points at its report', judged?.[P.job.report]?.url === reportUrl);
      check('an empty Why It Fits takes the summary', judged?.[P.job.fit]?.rich_text?.[0]?.text.content === 'Good fit');
      const evLine = (calls.find((c) => c.method === 'PATCH' && c.url.includes('/blocks/'))?.body as { children: { bulleted_list_item: { rich_text: { text: { content: string } }[] } }[] } | null)?.children[0].bulleted_list_item.rich_text[0].text.content ?? '';
      check('the timeline says what the rubric made of it, and who asked', evLine.includes('Evaluated — 85% · Apply · full evaluation') && evLine.includes('Claude Code'), evLine);
      check('the result carries the judgment', saved?.judgment.verdict === 'Apply' && saved?.reportUrl === reportUrl);

      // One report per job: an older evaluation page is trashed, other child pages are not.
      const oldReport = '55555555-5555-5555-5555-555555555555';
      const notes = '66666666-6666-6666-6666-666666666666';
      calls = [];
      globalThis.fetch = fake((m, u) => {
        if (m === 'POST' && u.endsWith('/pages')) return { object: 'page', id: reportId, url: reportUrl };
        if (m === 'GET' && u.includes(`/blocks/${pageId}/children`)) {
          return { object: 'list', has_more: false, results: [
            { object: 'block', id: oldReport, type: 'child_page', child_page: { title: 'Evaluation · Software Engineer at Acme' } },
            { object: 'block', id: notes, type: 'child_page', child_page: { title: 'Interview notes' } },
          ] };
        }
        if (u.includes('/blocks/')) return { object: 'list', results: [] };
        if (m === 'PATCH') return page({});
        return page({ [P.job.report]: { url: `https://www.notion.so/Evaluation-${oldReport.replace(/-/g, '')}` } });
      });
      if (ev.ok) await saveEvaluation(tenant('ntn_fake_one_report'), pageId, ev.value, { kind: 'AI', name: 'k' });
      const trashed = calls.filter((c) => c.method === 'PATCH' && (c.body as { in_trash?: boolean } | null)?.in_trash === true).map((c) => c.url);
      check('the previous report goes to the trash', trashed.some((u) => u.includes(oldReport)));
      check("the job's other pages are left alone", !trashed.some((u) => u.includes(notes)) && !trashed.some((u) => u.includes(reportId)));

      // The job's own write fails: the report just made must not be left behind.
      calls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
        const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (method === 'POST' && url.endsWith('/pages')) return ok({ object: 'page', id: reportId, url: reportUrl });
        if (method === 'PATCH' && url.includes(`/pages/${pageId}`)) {
          return new Response(JSON.stringify({ object: 'error', status: 400, code: 'validation_error', message: 'Report is expected to be files.' }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        if (method === 'PATCH') return ok({ object: 'page', id: reportId });
        return ok(page({}));
      }) as typeof fetch;
      let failedLoudly = false;
      try {
        if (ev.ok) await saveEvaluation(tenant('ntn_fake_fail'), pageId, ev.value, { kind: 'AI', name: 'k' });
      } catch {
        failedLoudly = true;
      }
      check('a failed save says so', failedLoudly);
      check('and trashes the report it had just made', calls.some((c) => c.method === 'PATCH' && c.url.includes(reportId) && (c.body as { in_trash?: boolean } | null)?.in_trash === true));

      // Someone deleted one of our columns after the migration: put it back, write again.
      let pagePatches = 0;
      calls = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
        const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('/data_sources/') && method === 'GET') return ok({ object: 'data_source', id: ds, properties: { [P.job.role]: { type: 'title' }, [P.job.status]: { type: 'select' } } });
        if (url.includes('/data_sources/') && method === 'PATCH') return ok({ object: 'data_source', id: ds, properties: {} });
        if (method === 'POST' && url.endsWith('/pages')) return ok({ object: 'page', id: reportId, url: reportUrl });
        if (method === 'PATCH' && url.includes(`/pages/${pageId}`) && ++pagePatches === 1) {
          return new Response(JSON.stringify({ object: 'error', status: 400, code: 'validation_error', message: 'Verdict is not a property that exists.' }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/blocks/')) return ok({ object: 'list', results: [] });
        if (method === 'PATCH') return ok(page({}));
        return ok(page({}));
      }) as typeof fetch;
      const quiet = console.error;
      console.error = () => undefined;
      try {
        if (ev.ok) await saveEvaluation(tenant('ntn_fake_heal'), pageId, ev.value, { kind: 'AI', name: 'k' });
      } finally {
        console.error = quiet;
      }
      const added = calls.find((c) => c.url.includes('/data_sources/') && c.method === 'PATCH')?.body as { properties?: Record<string, unknown> } | null;
      check('a missing column is put back', Boolean(added?.properties?.[P.job.verdict]) && !(P.job.status in (added?.properties ?? {})));
      check('and the write goes through the second time', pagePatches === 2);

      // A column of ours already there as another kind: refuse, and say which.
      calls = [];
      globalThis.fetch = fake((m, u) => (u.includes('/data_sources/') ? { object: 'data_source', id: ds, properties: { [P.job.report]: { type: 'files' } } } : page({})));
      let conflict = '';
      try {
        await ensureJobsSchema({ ...tenant('ntn_fake_clash'), jobsSchema: 1 });
      } catch (e) {
        conflict = e instanceof JobsError ? e.message : '';
      }
      check('a clashing column stops the migration and names the column', conflict.includes('“Report”') && !calls.some((c) => c.method === 'PATCH'));

      // Reading a job reads its report only when the report is the job's own child page.
      const own = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const reportPage = (withChild: boolean) =>
        fake((m, u) => {
          if (u.includes(`/blocks/${pageId}/children`)) return { object: 'list', has_more: false, results: withChild ? [{ object: 'block', id: own, type: 'child_page', child_page: { title: 'Evaluation · x' } }] : [] };
          if (u.includes(`/blocks/${own}/children`)) return { object: 'list', has_more: false, results: [{ object: 'block', id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'The report summary' }] } }] };
          return page({ [P.job.report]: { url: `https://www.notion.so/Evaluation-${own.replace(/-/g, '')}` } });
        });
      calls = [];
      globalThis.fetch = reportPage(true);
      const withReport = await getJob(tenant('ntn_fake_read'), pageId);
      check("a job's own report is read with it", withReport?.report?.summary === 'The report summary');
      calls = [];
      globalThis.fetch = reportPage(false);
      const pointedElsewhere = await getJob(tenant('ntn_fake_read2'), pageId);
      check('a Report link to a page that is not its child is never read', pointedElsewhere?.report === null && !calls.some((c) => c.url.includes(`/blocks/${own}/`)));

      calls = [];
      globalThis.fetch = fake(() => page({ [P.job.evaluation]: { select: { name: 'Full' } }, [P.job.evaluatedOn]: { date: { start: '2026-09-20' } } }));
      const q = parseEvaluation({ scores: { skills: 2, level: 2, location: 2, role: 2 } }, { depth: 'Quick' });
      let refused = false;
      try {
        if (q.ok) await saveEvaluation(tenant('ntn_fake_quick'), pageId, q.value, { kind: 'AI', name: 'k' });
      } catch (e) {
        refused = e instanceof JobsError && e.code === 'conflict';
      }
      check('a quick look never overwrites a full evaluation', refused && calls.every((c) => c.method === 'GET'));
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(process.env, dbEnv);
    }

    const props = jobProperties({ role: 'SDE', status: 'Found', skills: ['Go'], jobUrl: null, notes: 'n'.repeat(2500) });
    check('only the fields given are written', Object.keys(props).length === 5);
    check('long text becomes several runs', (props[P.job.notes] as { rich_text: unknown[] }).rich_text.length === 2);
    check('a cleared link is null, not an empty string', (props[P.job.jobUrl] as { url: unknown }).url === null);
    const mapped = mapJob({ id: 'p', url: 'u', created_time: 'c', properties: { [P.job.role]: { title: [{ plain_text: 'X' }] }, [P.job.skills]: { multi_select: [{ name: 'Go' }] }, [P.job.postedOn]: { date: { start: '2026-09-01T10:00:00.000+05:30' } } } });
    check('a page reads back as a job with safe defaults', mapped.role === 'X' && mapped.status === 'Found' && mapped.skills[0] === 'Go' && mapped.postedOn === '2026-09-01');

    const body = initialBody('First para.\n\nSecond para.', { date: TODAY, kind: 'found', text: 'on LinkedIn' });
    const asBlocks = body.map((b) => ({ type: b.type, [b.type]: { rich_text: b[b.type].rich_text.map((r: { text: { content: string } }) => ({ plain_text: r.text.content })) } }));
    const split = splitBody([...asBlocks, { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: formatEvent({ date: TODAY, kind: 'applied', text: 'via referral' }) }] } }]);
    check('the page body splits into description and timeline', split.description.length === 2 && split.timeline.length === 2);
    check('timeline order is kept', split.timeline[0].kind === 'found' && split.timeline[1].kind === 'applied');
    check('an event block is one bulleted line', eventBlock({ date: TODAY, kind: 'note', text: 'x' }).type === 'bulleted_list_item');
  }
}
