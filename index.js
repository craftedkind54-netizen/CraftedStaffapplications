require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events,
  MessageFlags,
} = require('discord.js');
const Database = require('better-sqlite3');
const { DateTime } = require('luxon');

// =====================================================
// CRAFTED SMP STAFF APPLICATION SYSTEM
// =====================================================

const GUILD_ID = '1543363950262100118';

const APPLICATION_CONTROL_CHANNEL_ID = '1548840885167587399';
const SUBMITTED_APPLICATIONS_CHANNEL_ID = '1548841190609129522';
const INTERVIEW_NOTIFICATION_CHANNEL_ID = '1548846551890137189';
const INTERVIEW_RESULTS_CHANNEL_ID = '1548849111179067472';

const MAIN_CATEGORY_ID = '1543364258308300840';
const SENIOR_STAFF_CATEGORY_ID = '1543368484220571658';

const OWNER_ROLE_ID = '1546564866045902978';
const CO_OWNER_ROLE_ID = '1548519417992974356';
const SENIOR_STAFF_ROLE_ID = '1543367669385011302';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// =====================================================
// CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// =====================================================
// DATABASE
// =====================================================

const db = new Database('crafted_staff_applications.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  age TEXT NOT NULL,
  experience TEXT NOT NULL,
  interview_ts INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submission_message_id TEXT,
  interview_text_channel_id TEXT,
  interview_voice_channel_id TEXT,
  scoring_channel_id TEXT,
  selected_questions TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS approvals (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS interviewers (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS scores (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY(app_id, staff_id, question_key)
);

CREATE TABLE IF NOT EXISTS score_sessions (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS reminders (
  app_id INTEGER NOT NULL,
  reminder_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY(app_id, reminder_key)
);

CREATE TABLE IF NOT EXISTS test_checks (
  check_key TEXT PRIMARY KEY,
  passed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

if (!getSetting('system_mode')) setSetting('system_mode', 'closed');

// =====================================================
// TEST CHECKLIST
// =====================================================

const TEST_CHECKS = [
  ['application_panel', 'Application panel'],
  ['application_form', 'Application form'],
  ['application_submission', 'Application submission'],
  ['staff_approvals', 'Staff approvals'],
  ['owner_override', 'Owner/Co-Owner approval override'],
  ['rescheduling', 'Rescheduling'],
  ['timezone_conversion', 'Time-zone conversion'],
  ['applicant_confirmation', 'Applicant confirmation'],
  ['interview_reminders', 'Interview reminders'],
  ['private_text_permissions', 'Private text channel permissions'],
  ['voice_permissions', 'Voice channel permissions'],
  ['random_questions', 'Random question selection'],
  ['scoring', '0–3 scoring'],
  ['two_interviewer_scoring', 'Two-interviewer scoring'],
  ['navigation', 'Previous/Next navigation'],
  ['restart_persistence', 'Bot restart persistence'],
  ['score_calculations', 'Score calculations'],
  ['end_interview', 'End Interview'],
  ['final_decision', 'Accept/Reject/Further Review'],
  ['test_cleanup', 'Test cleanup'],
];

function markTestCheck(key) {
  if (!TEST_CHECKS.some(([k]) => k === key)) return;
  db.prepare(`
    INSERT INTO test_checks(check_key, passed, updated_at)
    VALUES(?, 1, ?)
    ON CONFLICT(check_key) DO UPDATE SET passed = 1, updated_at = excluded.updated_at
  `).run(key, Date.now());
}

function resetTestChecks() {
  db.prepare('DELETE FROM test_checks').run();
}

function checklistText() {
  const passedRows = db.prepare('SELECT check_key FROM test_checks WHERE passed = 1').all();
  const passed = new Set(passedRows.map(r => r.check_key));
  const lines = TEST_CHECKS.map(([key, label]) => `${passed.has(key) ? '✅' : '⬜'} ${label}`);
  const count = TEST_CHECKS.filter(([key]) => passed.has(key)).length;
  return `${lines.join('\n')}\n\n**Testing Progress: ${count}/${TEST_CHECKS.length}**${count === TEST_CHECKS.length ? '\n\n✅ **ALL SYSTEMS TESTED**' : ''}`;
}

// =====================================================
// QUESTIONS
// Only the user's listed questions are used.
// =====================================================

const QUESTION_CATEGORIES = [
  {
    name: '📖 General Knowledge',
    questions: [
      'Why do you want to become a Moderator?',
      'What do you believe the role of a moderator is?',
      'What qualities make an excellent moderator?',
      'What does fairness mean to you?',
      'Why is professionalism important when moderating a community?',
    ],
  },
  {
    name: '🤝 Community & Leadership',
    questions: [
      'How would you help new players feel welcomed on the SMP?',
      'What would you do to improve the community experience?',
      'How do you handle disagreements with other people?',
      'What makes a good leader?',
      'Why should the staff team trust you with moderation permissions?',
    ],
  },
  {
    name: '⚖️ Rule Enforcement Scenarios',
    questions: [
      'You witness a player using inappropriate language in global chat. What actions would you take?',
      'A player is intentionally trying to provoke others into breaking rules. How would you deal with this?',
      'A player is bypassing chat filters and is repeatedly spamming chat after multiple warnings. How would you handle the situation?',
      'Several players report someone for hacking, but there is no evidence. What steps would you take before making a decision?',
    ],
  },
  {
    name: '🔥 Advanced Scenario Questions',
    questions: [
      'One of your close friends is caught cheating. They ask you not to report them. What would you do and why?',
      'A popular player is breaking rules, but many community members defend them because they are well-known. How would you handle the situation?',
      'You accidentally punish the wrong player. What would you do next?',
      'Another moderator gives a punishment that you believe is unfair. How would you address the situation?',
      'You are the only staff member online and multiple issues happen at the same time: a player is spamming, someone reports a hacker, and two players are arguing in chat. How would you prioritize and handle each situation?',
    ],
  },
  {
    name: '🧠 Judgment & Decision Making',
    questions: [
      'What would you do if you were unsure how to handle a moderation situation?',
      'When should a moderator ask for help from higher-ranking staff?',
      'What is more important: being liked by players or enforcing rules fairly? Explain your answer.',
      'How would you respond to a player who becomes angry after receiving a punishment?',
      'What would you do if someone accused you of staff abuse?',
    ],
  },
  {
    name: '🚨 Serious Staff Scenarios',
    questions: [
      'You discover another staff member abusing their permissions. What actions would you take?',
      'A player privately tells you they found a duplication exploit that could harm the economy. What would you do?',
      'A player threatens to leave the server unless their punishment is removed. How would you respond?',
      'You find evidence that a staff member is leaking private staff information. What would you do?',
      'A player creates multiple alternate accounts to evade punishments. How would you investigate and handle the situation?',
    ],
  },
  {
    name: '🎭 Bonus Question (Troll Check)',
    questions: [
      'You are given Owner rank for 5 minutes. What is the very first thing you do?',
      'As a moderator, you contain a role of leadership and persuasion. Without breaking character, persuade us why ketchup should be a soup.',
      'As being persuasive, explain why noodles should be on a pizza.',
      'Explain how coffee can be a type of tea.',
    ],
  },
];

function randomThreePerCategory() {
  const selected = [];
  QUESTION_CATEGORIES.forEach((category, categoryIndex) => {
    const indexes = category.questions.map((_, i) => i);
    for (let i = indexes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
    }
    indexes.slice(0, 3).forEach(questionIndex => {
      selected.push({
        key: `${categoryIndex}:${questionIndex}`,
        categoryIndex,
        questionIndex,
        category: category.name,
        question: category.questions[questionIndex],
      });
    });
  });
  return selected;
}

// =====================================================
// HELPERS
// =====================================================

const TZ_ALIASES = {
  HST: 'Pacific/Honolulu',
  HAWAII: 'Pacific/Honolulu',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  UTC: 'UTC',
  GMT: 'UTC',
};

function parseInterviewTime(input) {
  const parts = input.split('|').map(s => s.trim());
  if (parts.length !== 2) {
    return { ok: false, error: 'Use this format: `YYYY-MM-DD HH:MM | Timezone`\nExample: `2026-09-25 16:00 | HST`' };
  }

  const [dateTimePart, zoneRaw] = parts;
  const zone = TZ_ALIASES[zoneRaw.toUpperCase()] || zoneRaw;
  const dt = DateTime.fromFormat(dateTimePart, 'yyyy-MM-dd HH:mm', { zone });

  if (!dt.isValid) {
    return { ok: false, error: 'I could not read that date/time or time zone. Example: `2026-09-25 16:00 | HST`' };
  }

  return {
    ok: true,
    timestamp: Math.floor(dt.toSeconds()),
    zone: zoneRaw,
  };
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'applicant';
}

function statusLabel(status) {
  const map = {
    pending: '🟡 Pending Review',
    needs_time: '🟠 Needs Different Time',
    needs_interviewer: '🟠 Needs Interviewer',
    confirmed: '🟢 Interview Confirmed',
    rejected: '🔴 Rejected',
    in_progress: '🔵 Interview In Progress',
    completed: '✅ Interview Completed',
    accepted: '✅ Accepted',
    further_review: '🟡 Further Review',
  };
  return map[status] || status;
}

function isRoleMember(member, roleId) {
  return Boolean(member?.roles?.cache?.has(roleId));
}

function isOwner(member) {
  return isRoleMember(member, OWNER_ROLE_ID);
}

function isCoOwner(member) {
  return isRoleMember(member, CO_OWNER_ROLE_ID);
}

function isSenior(member) {
  return isRoleMember(member, SENIOR_STAFF_ROLE_ID);
}

function isAuthorizedStaff(member) {
  return isOwner(member) || isCoOwner(member) || isSenior(member);
}

function isOwnerOrCoOwner(member) {
  return isOwner(member) || isCoOwner(member);
}

async function safeEphemeral(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function fetchTextChannel(id) {
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

function getApplication(appId) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
}

function getActiveApplicationForUser(userId, mode) {
  return db.prepare(`
    SELECT * FROM applications
    WHERE user_id = ? AND mode = ?
      AND status NOT IN ('rejected', 'completed', 'accepted')
    ORDER BY id DESC LIMIT 1
  `).get(userId, mode);
}

function getInterviewers(appId) {
  return db.prepare('SELECT staff_id FROM interviewers WHERE app_id = ?').all(appId).map(r => r.staff_id);
}

function getApprovals(appId) {
  return db.prepare('SELECT staff_id FROM approvals WHERE app_id = ? ORDER BY created_at').all(appId).map(r => r.staff_id);
}

function getSelectedQuestions(app) {
  try {
    return app.selected_questions ? JSON.parse(app.selected_questions) : [];
  } catch {
    return [];
  }
}

function saveSelectedQuestions(appId, selected) {
  db.prepare('UPDATE applications SET selected_questions = ? WHERE id = ?').run(JSON.stringify(selected), appId);
}

function staffPermissionOverwrites(guild, applicantId = null, interviewerIds = []) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: CO_OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: SENIOR_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];

  if (applicantId) {
    overwrites.push({
      id: applicantId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  for (const id of interviewerIds) {
    if (!overwrites.some(o => o.id === id)) {
      overwrites.push({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
  }

  return overwrites;
}

// =====================================================
// MANAGEMENT PANEL
// =====================================================

function managementEmbed() {
  const mode = getSetting('system_mode', 'closed');
  let state = '🔴 Applications Closed';
  if (mode === 'test') state = '🧪 Testing Mode';
  if (mode === 'public') state = '🟢 Public Applications Open';

  return new EmbedBuilder()
    .setTitle('🛡️ Crafted SMP Staff Application System')
    .setDescription([
      `**Current Status:** ${state}`,
      '',
      'Use this panel to test, open, or close the staff application system.',
      '',
      '🧪 **Testing Mode** never counts as a real application.',
      '🚀 **Public Applications** must be manually enabled by Owner or Co-Owner.',
    ].join('\n'));
}

function managementRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('manage_test_mode').setLabel('Testing Mode').setEmoji('🧪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('manage_test_applicant').setLabel('Choose Test Applicant').setEmoji('👤').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('manage_checklist').setLabel('Test Checklist').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('manage_public_open').setLabel('Enable Public Applications').setEmoji('🚀').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('manage_close').setLabel('Close Applications').setEmoji('🔴').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('manage_reset_test').setLabel('Reset Test').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function ensureManagementPanel() {
  const channel = await fetchTextChannel(APPLICATION_CONTROL_CHANNEL_ID);
  if (!channel) throw new Error('Application control channel not found.');

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = messages?.find(m =>
    m.author.id === client.user.id &&
    m.components.some(row => row.components.some(c => c.customId === 'manage_test_mode'))
  );

  if (existing) {
    await existing.edit({ embeds: [managementEmbed()], components: managementRows() }).catch(() => null);
    return existing;
  }

  return channel.send({ embeds: [managementEmbed()], components: managementRows() });
}

async function refreshManagementPanel() {
  await ensureManagementPanel().catch(console.error);
}

// =====================================================
// PUBLIC / TEST APPLICATION PANELS
// =====================================================

function applicationPanelEmbed(isTest = false) {
  return new EmbedBuilder()
    .setTitle(isTest ? '🧪 Crafted SMP Staff Application — TEST MODE' : '🛡️ Crafted SMP Staff Applications')
    .setDescription([
      isTest ? '**This is a test application. It does not count as a real staff application.**' : '**Applications are currently open.**',
      '',
      'Click the button below to apply.',
      '',
      '**You will be asked for:**',
      '• Your age',
      '• Positive moderation experience',
      '• An interview date, time, and time zone',
      '',
      'Real interviews must normally be scheduled at least **1 week in advance**.',
      '',
      '📖 Make sure you prepare and study the Crafted SMP rules before your interview.',
    ].join('\n'));
}

function applicationButton(isTest = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(isTest ? 'apply_test' : 'apply_public')
      .setLabel(isTest ? 'Submit Test Application' : 'Apply for Staff')
      .setEmoji(isTest ? '🧪' : '🛡️')
      .setStyle(ButtonStyle.Primary)
  );
}

async function createPublicApplicationChannel(guild) {
  let channelId = getSetting('public_application_channel_id');
  if (channelId) {
    const existing = await guild.channels.fetch(channelId).catch(() => null);
    if (existing) return existing;
  }

  const channel = await guild.channels.create({
    name: 'staff-applications',
    type: ChannelType.GuildText,
    parent: MAIN_CATEGORY_ID,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
      },
    ],
    reason: 'Crafted SMP public staff applications opened',
  });

  await channel.send({ embeds: [applicationPanelEmbed(false)], components: [applicationButton(false)] });
  setSetting('public_application_channel_id', channel.id);
  return channel;
}

async function deletePublicApplicationChannel(guild) {
  const channelId = getSetting('public_application_channel_id');
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel) await channel.delete('Staff applications closed').catch(() => null);
  setSetting('public_application_channel_id', '');
}

async function createTestApplicantChannel(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('Test applicant is not in this server.');

  const oldId = getSetting('test_application_channel_id');
  if (oldId) {
    const old = await guild.channels.fetch(oldId).catch(() => null);
    if (old) await old.delete('Replacing test application channel').catch(() => null);
  }

  const channel = await guild.channels.create({
    name: `test-application-${slugify(member.user.username)}`,
    type: ChannelType.GuildText,
    parent: MAIN_CATEGORY_ID,
    permissionOverwrites: staffPermissionOverwrites(guild, userId),
    reason: 'Crafted SMP staff application testing mode',
  });

  await channel.send({
    content: `<@${userId}>`,
    embeds: [applicationPanelEmbed(true)],
    components: [applicationButton(true)],
  });

  setSetting('test_application_channel_id', channel.id);
  markTestCheck('application_panel');
  return channel;
}

// =====================================================
// APPLICATION FORM
// =====================================================

function buildApplicationModal(mode) {
  const modal = new ModalBuilder()
    .setCustomId(`application_modal:${mode}`)
    .setTitle(mode === 'test' ? 'TEST Staff Application' : 'Staff Application');

  const age = new TextInputBuilder()
    .setCustomId('age')
    .setLabel('What is your age?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const experience = new TextInputBuilder()
    .setCustomId('experience')
    .setLabel('Positive moderation experience')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const availability = new TextInputBuilder()
    .setCustomId('availability')
    .setLabel('Interview: YYYY-MM-DD HH:MM | Timezone')
    .setPlaceholder('2026-09-25 16:00 | HST')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(age),
    new ActionRowBuilder().addComponents(experience),
    new ActionRowBuilder().addComponents(availability),
  );

  return modal;
}

async function postSubmittedApplication(appId) {
  const app = getApplication(appId);
  const channel = await fetchTextChannel(SUBMITTED_APPLICATIONS_CHANNEL_ID);
  if (!channel) throw new Error('Submitted applications channel not found.');

  const approvals = getApprovals(appId);
  const interviewers = getInterviewers(appId);

  const embed = new EmbedBuilder()
    .setTitle(app.mode === 'test' ? '🧪 TEST APPLICATION' : '🛡️ Staff Application');

  if (app.mode === 'test') embed.setDescription('**NOT A REAL APPLICATION**');

  embed.addFields(
      { name: 'Applicant', value: `<@${app.user_id}>`, inline: true },
      { name: 'Age', value: app.age, inline: true },
      { name: 'Status', value: statusLabel(app.status), inline: true },
      { name: 'Interview Time', value: `<t:${app.interview_ts}:F>\n<t:${app.interview_ts}:R>`, inline: false },
      { name: 'Time Zone Entered', value: app.timezone, inline: true },
      { name: 'Moderation Experience', value: app.experience.slice(0, 1024), inline: false },
      { name: 'Approvals', value: approvals.length ? approvals.map(id => `<@${id}>`).join('\n') : 'None yet', inline: true },
      { name: 'Interviewers', value: interviewers.length ? interviewers.map(id => `<@${id}>`).join('\n') : 'Not assigned', inline: true },
    )
    .setFooter({ text: `Application ID: ${app.id}` });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${app.id}`).setLabel('Approve Interview').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reschedule_request:${app.id}`).setLabel('Choose Different Time').setEmoji('📅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cant_make:${app.id}`).setLabel("Can't Make It").setEmoji('❌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`assign_interviewers:${app.id}`).setLabel('Assign Interviewers').setEmoji('👥').setStyle(ButtonStyle.Primary),
  );

  let message;
  if (app.submission_message_id) {
    message = await channel.messages.fetch(app.submission_message_id).catch(() => null);
  }

  if (message) {
    await message.edit({ embeds: [embed], components: [row1] });
  } else {
    message = await channel.send({ embeds: [embed], components: [row1] });
    db.prepare('UPDATE applications SET submission_message_id = ? WHERE id = ?').run(message.id, app.id);
  }
}

// =====================================================
// INTERVIEW CONFIRMATION / CHANNELS
// =====================================================

async function confirmInterview(appId, guild) {
  let app = getApplication(appId);
  if (!app) return;
  if (['confirmed', 'in_progress', 'completed', 'accepted'].includes(app.status)) return;

  let selected = getSelectedQuestions(app);
  if (!selected.length) {
    selected = randomThreePerCategory();
    saveSelectedQuestions(app.id, selected);
    if (app.mode === 'test') markTestCheck('random_questions');
  }

  const interviewers = getInterviewers(appId);
  const member = await guild.members.fetch(app.user_id).catch(() => null);
  const applicantName = member?.user?.username || `user-${app.user_id}`;

  let textChannel = app.interview_text_channel_id
    ? await guild.channels.fetch(app.interview_text_channel_id).catch(() => null)
    : null;

  if (!textChannel) {
    textChannel = await guild.channels.create({
      name: `interview-${slugify(applicantName)}`,
      type: ChannelType.GuildText,
      parent: MAIN_CATEGORY_ID,
      permissionOverwrites: staffPermissionOverwrites(guild, app.user_id, interviewers),
      reason: `Interview channel for application ${app.id}`,
    });

    db.prepare('UPDATE applications SET interview_text_channel_id = ? WHERE id = ?').run(textChannel.id, app.id);
    if (app.mode === 'test') markTestCheck('private_text_permissions');
  }

  db.prepare("UPDATE applications SET status = 'confirmed' WHERE id = ?").run(app.id);
  app = getApplication(app.id);

  const controls = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`start_interview:${app.id}`).setLabel('Start Interview').setEmoji('🎙️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`end_interview:${app.id}`).setLabel('End Interview').setEmoji('🏁').setStyle(ButtonStyle.Danger),
    ),
  ];

  if (app.mode === 'test') {
    controls.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`simulate_reminder:${app.id}:24h`).setLabel('Simulate 24h').setEmoji('🧪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`simulate_reminder:${app.id}:1h`).setLabel('Simulate 1h').setEmoji('🧪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`simulate_reminder:${app.id}:10m`).setLabel('Simulate 10m').setEmoji('🧪').setStyle(ButtonStyle.Secondary),
      )
    );
  }

  await textChannel.send({
    content: `<@${app.user_id}> ${interviewers.map(id => `<@${id}>`).join(' ')}`,
    embeds: [
      new EmbedBuilder()
        .setTitle(app.mode === 'test' ? '🧪 TEST Interview Confirmed' : '✅ Staff Interview Confirmed')
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          `**Time:** <t:${app.interview_ts}:F> (<t:${app.interview_ts}:R>)`,
          `**Interviewers:** ${interviewers.length ? interviewers.map(id => `<@${id}>`).join(', ') : 'Staff assignment pending'}`,
          '',
          '📖 Make sure you have read and studied the Crafted SMP rules before your interview.',
        ].join('\n')),
    ],
    components: controls,
  });

  if (app.mode === 'test') markTestCheck('applicant_confirmation');

  const user = await client.users.fetch(app.user_id).catch(() => null);
  if (user) {
    await user.send({
      content: [
        app.mode === 'test' ? '🧪 **TEST INTERVIEW CONFIRMED**' : '✅ **Your Crafted SMP Staff Interview is confirmed!**',
        `Time: <t:${app.interview_ts}:F> (<t:${app.interview_ts}:R>)`,
        `Interviewers: ${interviewers.length ? interviewers.map(id => `<@${id}>`).join(', ') : 'Being assigned'}`,
        'Please study the Crafted SMP rules before your interview.',
      ].join('\n'),
    }).catch(() => null);
  }

  await postSubmittedApplication(app.id);
}

// =====================================================
// REMINDERS
// =====================================================

async function sendInterviewReminder(app, key, label) {
  const channel = await fetchTextChannel(INTERVIEW_NOTIFICATION_CHANNEL_ID);
  if (!channel) return;
  const interviewers = getInterviewers(app.id);

  await channel.send({
    content: interviewers.map(id => `<@${id}>`).join(' '),
    embeds: [
      new EmbedBuilder()
        .setTitle(app.mode === 'test' ? `🧪 TEST Reminder — ${label}` : `⏰ Interview Reminder — ${label}`)
        .setDescription(`Applicant: <@${app.user_id}>\nInterview: <t:${app.interview_ts}:F> (<t:${app.interview_ts}:R>)`),
    ],
  });

  db.prepare('INSERT OR IGNORE INTO reminders(app_id, reminder_key, sent_at) VALUES(?, ?, ?)')
    .run(app.id, key, Date.now());

  if (app.mode === 'test') markTestCheck('interview_reminders');
}

async function reminderSweep() {
  const now = unixNow();
  const apps = db.prepare(`
    SELECT * FROM applications
    WHERE mode = 'real' AND status = 'confirmed' AND interview_ts > ?
  `).all(now - 300);

  for (const app of apps) {
    const seconds = app.interview_ts - now;
    const windows = [
      ['24h', 24 * 3600, '24 Hours'],
      ['1h', 3600, '1 Hour'],
      ['10m', 600, '10 Minutes'],
    ];

    for (const [key, threshold, label] of windows) {
      const already = db.prepare('SELECT 1 FROM reminders WHERE app_id = ? AND reminder_key = ?').get(app.id, key);
      if (!already && seconds <= threshold && seconds > Math.max(0, threshold - 120)) {
        await sendInterviewReminder(app, key, label).catch(console.error);
      }
    }
  }
}

// =====================================================
// SCORING
// =====================================================

function scoringEmbed(app, staffId) {
  const selected = getSelectedQuestions(app);
  let session = db.prepare('SELECT * FROM score_sessions WHERE app_id = ? AND staff_id = ?').get(app.id, staffId);
  if (!session) {
    db.prepare('INSERT INTO score_sessions(app_id, staff_id, current_index, finished) VALUES(?, ?, 0, 0)').run(app.id, staffId);
    session = { current_index: 0, finished: 0 };
  }

  const index = Math.max(0, Math.min(session.current_index, selected.length - 1));
  const item = selected[index];
  const scoreRow = db.prepare('SELECT score FROM scores WHERE app_id = ? AND staff_id = ? AND question_key = ?')
    .get(app.id, staffId, item.key);
  const scoreText = scoreRow ? `${scoreRow.score}/3` : 'Not scored';
  const categoryPosition = selected.slice(0, index + 1).filter(q => q.categoryIndex === item.categoryIndex).length;

  return new EmbedBuilder()
    .setTitle('🛡️ Crafted SMP Interview Scorecard')
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      `**Category:** ${item.category}`,
      `**Category Question:** ${categoryPosition}/3`,
      `**Overall Progress:** ${index + 1}/${selected.length}`,
      '',
      `### ${item.question}`,
      '',
      `**Your Score:** ${scoreText}`,
      '',
      '**3/3** — Excellent',
      '**2/3** — Good',
      '**1/3** — Weak',
      '**0/3** — Failed / No Answer',
    ].join('\n'));
}

function scoringRows(app, staffId) {
  const selected = getSelectedQuestions(app);
  const session = db.prepare('SELECT * FROM score_sessions WHERE app_id = ? AND staff_id = ?').get(app.id, staffId) || { current_index: 0 };
  const index = Math.max(0, Math.min(session.current_index, selected.length - 1));

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`score:${app.id}:${index}:0`).setLabel('0/3').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`score:${app.id}:${index}:1`).setLabel('1/3').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`score:${app.id}:${index}:2`).setLabel('2/3').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`score:${app.id}:${index}:3`).setLabel('3/3').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`score_prev:${app.id}`).setLabel('Previous').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(`score_next:${app.id}`).setLabel('Next').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(index >= selected.length - 1),
      new ButtonBuilder().setCustomId(`score_finish:${app.id}`).setLabel('Finish My Scoring').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
  ];
}

function interviewerScore(appId, staffId) {
  const total = db.prepare('SELECT COALESCE(SUM(score), 0) AS total, COUNT(*) AS count FROM scores WHERE app_id = ? AND staff_id = ?')
    .get(appId, staffId);
  return { total: total.total, count: total.count };
}

function allInterviewersFinished(appId) {
  const interviewers = getInterviewers(appId);
  if (!interviewers.length) return false;
  return interviewers.every(id => {
    const row = db.prepare('SELECT finished FROM score_sessions WHERE app_id = ? AND staff_id = ?').get(appId, id);
    return row?.finished === 1;
  });
}

async function createScoringChannel(app, guild) {
  let channel = app.scoring_channel_id ? await guild.channels.fetch(app.scoring_channel_id).catch(() => null) : null;
  if (channel) return channel;

  const member = await guild.members.fetch(app.user_id).catch(() => null);
  const applicantName = member?.user?.username || `user-${app.user_id}`;

  channel = await guild.channels.create({
    name: `score-${slugify(applicantName)}`,
    type: ChannelType.GuildText,
    parent: SENIOR_STAFF_CATEGORY_ID,
    permissionOverwrites: staffPermissionOverwrites(guild),
    reason: `Private scoring for application ${app.id}`,
  });

  db.prepare('UPDATE applications SET scoring_channel_id = ? WHERE id = ?').run(channel.id, app.id);

  const interviewers = getInterviewers(app.id);
  await channel.send({
    content: interviewers.map(id => `<@${id}>`).join(' '),
    embeds: [
      new EmbedBuilder()
        .setTitle('🛡️ Trial Moderator Promotion Board')
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          `**Interviewers:** ${interviewers.map(id => `<@${id}>`).join(', ') || 'Not assigned'}`,
          '',
          'Welcome to the Moderator Application Process!',
          'Moderators are expected to be mature, active, respectful, and capable of handling situations professionally.',
          '',
          'Applicants have about **1 minute per question**. A question not answered, or a long delay, can affect the score.',
          'This meeting may be recorded/reviewed according to the server’s disclosed interview policy.',
          '',
          'Each interviewer scores independently. Click **Open My Scorecard** below.',
        ].join('\n')),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`open_scorecard:${app.id}`).setLabel('Open My Scorecard').setEmoji('⭐').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`end_interview:${app.id}`).setLabel('End Interview').setEmoji('🏁').setStyle(ButtonStyle.Danger),
      ),
    ],
  });

  return channel;
}

// =====================================================
// INTERVIEW START / END / RESULTS
// =====================================================

async function startInterview(appId, guild, starterId) {
  let app = getApplication(appId);
  if (!app) throw new Error('Application not found.');
  if (app.status === 'in_progress') throw new Error('This interview is already in progress.');
  if (['completed', 'accepted', 'rejected'].includes(app.status)) throw new Error('This interview is already finished.');

  let interviewers = getInterviewers(app.id);
  if (!interviewers.length) {
    db.prepare('INSERT OR IGNORE INTO interviewers(app_id, staff_id) VALUES(?, ?)').run(app.id, starterId);
    interviewers = [starterId];
  }

  let selected = getSelectedQuestions(app);
  if (!selected.length) {
    selected = randomThreePerCategory();
    saveSelectedQuestions(app.id, selected);
  }

  let voice = app.interview_voice_channel_id ? await guild.channels.fetch(app.interview_voice_channel_id).catch(() => null) : null;
  if (!voice) {
    const member = await guild.members.fetch(app.user_id).catch(() => null);
    const applicantName = member?.user?.username || 'applicant';
    voice = await guild.channels.create({
      name: `Interview - ${applicantName}`.slice(0, 90),
      type: ChannelType.GuildVoice,
      parent: MAIN_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
        { id: app.user_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        { id: OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        { id: CO_OWNER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
        { id: SENIOR_STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      ],
      reason: `Interview voice channel for application ${app.id}`,
    });
    db.prepare('UPDATE applications SET interview_voice_channel_id = ? WHERE id = ?').run(voice.id, app.id);
    if (app.mode === 'test') markTestCheck('voice_permissions');
  }

  db.prepare("UPDATE applications SET status = 'in_progress' WHERE id = ?").run(app.id);
  app = getApplication(app.id);
  await createScoringChannel(app, guild);
  await postSubmittedApplication(app.id);
}

function categoryScoresForStaff(app, staffId) {
  const selected = getSelectedQuestions(app);
  return QUESTION_CATEGORIES.map((cat, categoryIndex) => {
    const categoryQuestions = selected.filter(q => q.categoryIndex === categoryIndex);
    let total = 0;
    for (const q of categoryQuestions) {
      const row = db.prepare('SELECT score FROM scores WHERE app_id = ? AND staff_id = ? AND question_key = ?')
        .get(app.id, staffId, q.key);
      total += row?.score || 0;
    }
    return { name: cat.name, total, max: 9 };
  });
}

async function postResults(appId) {
  const app = getApplication(appId);
  const channel = await fetchTextChannel(INTERVIEW_RESULTS_CHANNEL_ID);
  if (!app || !channel) return;

  const interviewers = getInterviewers(app.id);
  const staffTotals = interviewers.map(id => ({ id, ...interviewerScore(app.id, id) }));
  const combined = staffTotals.reduce((sum, s) => sum + s.total, 0);
  const maxPer = 63;
  const combinedMax = maxPer * Math.max(interviewers.length, 1);
  const percent = combinedMax ? (combined / combinedMax) * 100 : 0;

  const fields = [];
  for (const staff of staffTotals) {
    fields.push({
      name: `Interviewer: <@${staff.id}>`,
      value: `**${staff.total}/${maxPer}** — ${((staff.total / maxPer) * 100).toFixed(1)}%`,
      inline: false,
    });

    const cats = categoryScoresForStaff(app, staff.id);
    fields.push({
      name: 'Category Scores',
      value: cats.map(c => `${c.name}: **${c.total}/${c.max}**`).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  fields.push({
    name: 'Combined Result',
    value: `**${combined}/${combinedMax}**\n**${percent.toFixed(1)}%**`,
    inline: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(app.mode === 'test' ? '🧪 TEST RESULTS — NOT A REAL APPLICATION' : '🛡️ Crafted SMP Staff Interview Results')
    .setDescription(`**Applicant:** <@${app.user_id}>\n**Status:** ${statusLabel(app.status)}`)
    .addFields(fields)
    .setFooter({ text: `Application ID: ${app.id}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`final_accept:${app.id}`).setLabel('Accept Applicant').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`final_reject:${app.id}`).setLabel('Reject Applicant').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`final_review:${app.id}`).setLabel('Further Review').setEmoji('🟡').setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
  if (app.mode === 'test') markTestCheck('score_calculations');
}

async function endInterview(appId, guild) {
  let app = getApplication(appId);
  if (!app) throw new Error('Application not found.');

  if (!allInterviewersFinished(app.id)) {
    throw new Error('All assigned interviewers must finish their scorecards before ending the interview.');
  }

  if (app.interview_voice_channel_id) {
    const voice = await guild.channels.fetch(app.interview_voice_channel_id).catch(() => null);
    if (voice) await voice.delete('Interview ended').catch(() => null);
  }

  db.prepare(`
    UPDATE applications
    SET status = 'completed', completed_at = ?, interview_voice_channel_id = NULL
    WHERE id = ?
  `).run(Date.now(), app.id);

  app = getApplication(app.id);
  await postSubmittedApplication(app.id);
  await postResults(app.id);
  if (app.mode === 'test') markTestCheck('end_interview');
}

// =====================================================
// TEST RESET
// =====================================================

async function resetTestData(guild) {
  const apps = db.prepare("SELECT * FROM applications WHERE mode = 'test'").all();

  for (const app of apps) {
    for (const id of [app.interview_text_channel_id, app.interview_voice_channel_id, app.scoring_channel_id]) {
      if (!id) continue;
      const channel = await guild.channels.fetch(id).catch(() => null);
      if (channel) await channel.delete('Resetting Crafted SMP test data').catch(() => null);
    }
  }

  const testPanelId = getSetting('test_application_channel_id');
  if (testPanelId) {
    const channel = await guild.channels.fetch(testPanelId).catch(() => null);
    if (channel) await channel.delete('Resetting test application panel').catch(() => null);
  }

  const ids = apps.map(a => a.id);
  const tx = db.transaction(() => {
    for (const id of ids) {
      db.prepare('DELETE FROM approvals WHERE app_id = ?').run(id);
      db.prepare('DELETE FROM interviewers WHERE app_id = ?').run(id);
      db.prepare('DELETE FROM scores WHERE app_id = ?').run(id);
      db.prepare('DELETE FROM score_sessions WHERE app_id = ?').run(id);
      db.prepare('DELETE FROM reminders WHERE app_id = ?').run(id);
      db.prepare('DELETE FROM applications WHERE id = ?').run(id);
    }
  });
  tx();

  setSetting('test_application_channel_id', '');
  setSetting('system_mode', 'closed');
  markTestCheck('test_cleanup');
}

// =====================================================
// READY
// =====================================================

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetchMe();
    await ensureManagementPanel();

    const inProgressTest = db.prepare("SELECT 1 FROM applications WHERE mode = 'test' AND status = 'in_progress' LIMIT 1").get();
    if (inProgressTest) markTestCheck('restart_persistence');

    setInterval(() => reminderSweep().catch(console.error), 60_000);
    reminderSweep().catch(console.error);
  } catch (error) {
    console.error('❌ Startup error:', error);
  }
});

// =====================================================
// INTERACTIONS
// =====================================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    const guild = interaction.guild || await client.guilds.fetch(GUILD_ID);
    const member = interaction.member || (interaction.user ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);

    // ---------------- Management ----------------
    if (interaction.isButton() && interaction.customId === 'manage_test_mode') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Senior Staff, Co-Owner, or Owner only.');
      await deletePublicApplicationChannel(guild);
      setSetting('system_mode', 'test');
      resetTestChecks();
      await refreshManagementPanel();
      return safeEphemeral(interaction, '🧪 Testing Mode is now enabled. Use **Choose Test Applicant** next.');
    }

    if (interaction.isButton() && interaction.customId === 'manage_test_applicant') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      if (getSetting('system_mode') !== 'test') return safeEphemeral(interaction, 'Enable **Testing Mode** first.');

      const select = new UserSelectMenuBuilder()
        .setCustomId('select_test_applicant')
        .setPlaceholder('Choose the test applicant')
        .setMinValues(1)
        .setMaxValues(1);

      return interaction.reply({
        content: 'Choose who should act as the test applicant:',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'select_test_applicant') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const userId = interaction.values[0];
      const channel = await createTestApplicantChannel(guild, userId);
      return interaction.update({ content: `✅ Test applicant selected: <@${userId}>\nTest channel: ${channel}`, components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'manage_checklist') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle('📋 Staff Application Test Checklist').setDescription(checklistText())],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isButton() && interaction.customId === 'manage_public_open') {
      if (!isOwnerOrCoOwner(member)) return safeEphemeral(interaction, '❌ Only the Owner or Co-Owner can enable Public Applications.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_public_open').setLabel('Yes — Go Public').setEmoji('🚀').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_public_open').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({
        content: '⚠️ **PUBLIC RELEASE**\nThis will make the Crafted SMP Staff Application system available to real applicants. Are you sure?',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isButton() && interaction.customId === 'confirm_public_open') {
      if (!isOwnerOrCoOwner(member)) return safeEphemeral(interaction, '❌ Owner/Co-Owner only.');
      const channel = await createPublicApplicationChannel(guild);
      setSetting('system_mode', 'public');
      await refreshManagementPanel();
      return interaction.update({ content: `✅ Public staff applications are now open: ${channel}`, components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'cancel_public_open') {
      return interaction.update({ content: 'Cancelled. Public applications remain unchanged.', components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'manage_close') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      await deletePublicApplicationChannel(guild);
      setSetting('system_mode', 'closed');
      await refreshManagementPanel();
      return safeEphemeral(interaction, '🔴 Applications are now closed. Existing applications were kept.');
    }

    if (interaction.isButton() && interaction.customId === 'manage_reset_test') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_reset_test').setLabel('Reset Test').setEmoji('✅').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_reset_test').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({
        content: '⚠️ Are you sure you want to delete all **TEST** data? Real application data will not be affected.',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isButton() && interaction.customId === 'confirm_reset_test') {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      await interaction.deferUpdate();
      await resetTestData(guild);
      await refreshManagementPanel();
      return interaction.editReply({ content: '✅ Test data was reset. Real applications were not touched.', components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'cancel_reset_test') {
      return interaction.update({ content: 'Test reset cancelled.', components: [] });
    }

    // ---------------- Apply ----------------
    if (interaction.isButton() && (interaction.customId === 'apply_test' || interaction.customId === 'apply_public')) {
      const mode = interaction.customId === 'apply_test' ? 'test' : 'real';
      if (mode === 'test' && getSetting('system_mode') !== 'test') return safeEphemeral(interaction, 'Testing Mode is not currently enabled.');
      if (mode === 'real' && getSetting('system_mode') !== 'public') return safeEphemeral(interaction, 'Public staff applications are currently closed.');

      const active = getActiveApplicationForUser(interaction.user.id, mode);
      if (active) return safeEphemeral(interaction, `You already have an active ${mode === 'test' ? 'test ' : ''}application (ID ${active.id}).`);

      if (mode === 'test') markTestCheck('application_form');
      return interaction.showModal(buildApplicationModal(mode));
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('application_modal:')) {
      const mode = interaction.customId.split(':')[1];
      const age = interaction.fields.getTextInputValue('age').trim();
      const experience = interaction.fields.getTextInputValue('experience').trim();
      const availability = interaction.fields.getTextInputValue('availability').trim();
      const parsed = parseInterviewTime(availability);

      if (!parsed.ok) return safeEphemeral(interaction, `❌ ${parsed.error}`);
      if (mode === 'real' && parsed.timestamp < unixNow() + (7 * 24 * 3600)) {
        return safeEphemeral(interaction, '❌ Real interviews must normally be scheduled at least **1 week in advance**. Please choose a later date.');
      }

      const result = db.prepare(`
        INSERT INTO applications(user_id, mode, age, experience, interview_ts, timezone, status, created_at)
        VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(interaction.user.id, mode, age, experience, parsed.timestamp, parsed.zone, Date.now());

      if (mode === 'test') {
        markTestCheck('application_submission');
        markTestCheck('timezone_conversion');
      }

      await postSubmittedApplication(result.lastInsertRowid);
      return interaction.reply({
        content: `${mode === 'test' ? '🧪 **TEST APPLICATION SUBMITTED**' : '✅ **Application submitted!**'}\nInterview request: <t:${parsed.timestamp}:F> (<t:${parsed.timestamp}:R>)\n\n📖 Make sure you prepare and study the Crafted SMP rules.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---------------- Approval ----------------
    if (interaction.isButton() && interaction.customId.startsWith('approve:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');

      const existing = db.prepare('SELECT 1 FROM approvals WHERE app_id = ? AND staff_id = ?').get(appId, interaction.user.id);
      if (existing) return safeEphemeral(interaction, 'You already approved this interview.');

      db.prepare('INSERT INTO approvals(app_id, staff_id, created_at) VALUES(?, ?, ?)').run(appId, interaction.user.id, Date.now());
      db.prepare('INSERT OR IGNORE INTO interviewers(app_id, staff_id) VALUES(?, ?)').run(appId, interaction.user.id);

      const approvals = getApprovals(appId);
      let ownerOverride = false;
      for (const staffId of approvals) {
        const staffMember = await guild.members.fetch(staffId).catch(() => null);
        if (staffMember && isOwnerOrCoOwner(staffMember)) {
          ownerOverride = true;
          break;
        }
      }

      if (app.mode === 'test') {
        markTestCheck('staff_approvals');
        if (ownerOverride) markTestCheck('owner_override');
      }

      await postSubmittedApplication(appId);

      if (ownerOverride || approvals.length >= 2) {
        await confirmInterview(appId, guild);
        return safeEphemeral(interaction, '✅ Interview approved and confirmed.');
      }

      return safeEphemeral(interaction, `✅ Your approval was recorded. **${approvals.length}/2** Senior Staff approvals received.`);
    }

    // ---------------- Assign interviewers ----------------
    if (interaction.isButton() && interaction.customId.startsWith('assign_interviewers:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const select = new UserSelectMenuBuilder()
        .setCustomId(`assign_select:${appId}`)
        .setPlaceholder('Select 1 or 2 interviewers')
        .setMinValues(1)
        .setMaxValues(2);
      return interaction.reply({ content: 'Select the staff members who will conduct this interview:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('assign_select:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const valid = [];
      for (const id of interaction.values) {
        const selectedMember = await guild.members.fetch(id).catch(() => null);
        if (selectedMember && isAuthorizedStaff(selectedMember)) valid.push(id);
      }
      if (!valid.length) return interaction.update({ content: '❌ None of the selected users have Owner, Co-Owner, or Senior Staff.', components: [] });

      db.prepare('DELETE FROM interviewers WHERE app_id = ?').run(appId);
      for (const id of valid) db.prepare('INSERT INTO interviewers(app_id, staff_id) VALUES(?, ?)').run(appId, id);
      await postSubmittedApplication(appId);
      return interaction.update({ content: `✅ Interviewers assigned: ${valid.map(id => `<@${id}>`).join(', ')}`, components: [] });
    }

    // ---------------- Rescheduling ----------------
    if (interaction.isButton() && interaction.customId.startsWith('reschedule_request:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');
      db.prepare("UPDATE applications SET status = 'needs_time' WHERE id = ?").run(appId);
      await postSubmittedApplication(appId);

      const user = await client.users.fetch(app.user_id).catch(() => null);
      if (user) {
        await user.send({
          content: '📅 Staff cannot make your requested interview time. Please choose a different time.',
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`applicant_reschedule:${app.id}`).setLabel('Choose New Time').setEmoji('📅').setStyle(ButtonStyle.Primary)
          )],
        }).catch(() => null);
      }
      if (app.mode === 'test') markTestCheck('rescheduling');
      return safeEphemeral(interaction, '📅 The applicant was asked to choose a different time.');
    }

    if (interaction.isButton() && interaction.customId.startsWith('applicant_reschedule:')) {
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app || app.user_id !== interaction.user.id) return safeEphemeral(interaction, 'This reschedule button is not for you.');

      const modal = new ModalBuilder().setCustomId(`reschedule_modal:${appId}`).setTitle('Choose a New Interview Time');
      const input = new TextInputBuilder()
        .setCustomId('availability')
        .setLabel('YYYY-MM-DD HH:MM | Timezone')
        .setPlaceholder('2026-09-25 16:00 | HST')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('reschedule_modal:')) {
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app || app.user_id !== interaction.user.id) return safeEphemeral(interaction, 'Application not found.');
      const parsed = parseInterviewTime(interaction.fields.getTextInputValue('availability').trim());
      if (!parsed.ok) return safeEphemeral(interaction, `❌ ${parsed.error}`);
      if (app.mode === 'real' && parsed.timestamp < unixNow() + (7 * 24 * 3600)) {
        return safeEphemeral(interaction, '❌ Please choose a time at least 1 week in advance.');
      }

      db.prepare("UPDATE applications SET interview_ts = ?, timezone = ?, status = 'pending' WHERE id = ?")
        .run(parsed.timestamp, parsed.zone, appId);
      db.prepare('DELETE FROM approvals WHERE app_id = ?').run(appId);
      await postSubmittedApplication(appId);
      return interaction.reply({ content: `✅ New interview request: <t:${parsed.timestamp}:F>`, flags: MessageFlags.Ephemeral });
    }

    // ---------------- Can't make it ----------------
    if (interaction.isButton() && interaction.customId.startsWith('cant_make:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const result = db.prepare('DELETE FROM interviewers WHERE app_id = ? AND staff_id = ?').run(appId, interaction.user.id);
      if (!result.changes) return safeEphemeral(interaction, 'You were not assigned as an interviewer for this application.');
      db.prepare("UPDATE applications SET status = 'needs_interviewer' WHERE id = ?").run(appId);
      await postSubmittedApplication(appId);
      return safeEphemeral(interaction, '✅ You were removed as an interviewer. Another staff member can now be assigned.');
    }

    // ---------------- Test reminders ----------------
    if (interaction.isButton() && interaction.customId.startsWith('simulate_reminder:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const [, appIdRaw, key] = interaction.customId.split(':');
      const app = getApplication(Number(appIdRaw));
      if (!app || app.mode !== 'test') return safeEphemeral(interaction, 'This is only available for test applications.');
      const labels = { '24h': '24 Hours', '1h': '1 Hour', '10m': '10 Minutes' };
      await sendInterviewReminder(app, `test-${key}-${Date.now()}`, labels[key] || key);
      return safeEphemeral(interaction, `🧪 Simulated the ${labels[key] || key} reminder.`);
    }

    // ---------------- Start interview ----------------
    if (interaction.isButton() && interaction.customId.startsWith('start_interview:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const interviewers = getInterviewers(appId);
      if (interviewers.length && !interviewers.includes(interaction.user.id) && !isOwnerOrCoOwner(member)) {
        return safeEphemeral(interaction, '❌ Only an assigned interviewer, Owner, or Co-Owner can start this interview.');
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await startInterview(appId, guild, interaction.user.id);
      return interaction.editReply('🎙️ Interview started. The private voice channel and staff scoring channel are ready.');
    }

    // ---------------- Scorecard ----------------
    if (interaction.isButton() && interaction.customId.startsWith('open_scorecard:')) {
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');
      const interviewers = getInterviewers(appId);
      if (!interviewers.includes(interaction.user.id) && !isOwnerOrCoOwner(member)) return safeEphemeral(interaction, '❌ You are not an assigned interviewer.');
      if (!interviewers.includes(interaction.user.id)) db.prepare('INSERT OR IGNORE INTO interviewers(app_id, staff_id) VALUES(?, ?)').run(appId, interaction.user.id);

      return interaction.reply({ embeds: [scoringEmbed(app, interaction.user.id)], components: scoringRows(app, interaction.user.id), flags: MessageFlags.Ephemeral });
    }

    if (interaction.isButton() && interaction.customId.startsWith('score:')) {
      const [, appIdRaw, indexRaw, scoreRaw] = interaction.customId.split(':');
      const appId = Number(appIdRaw);
      const index = Number(indexRaw);
      const score = Number(scoreRaw);
      const app = getApplication(appId);
      const selected = app ? getSelectedQuestions(app) : [];
      const interviewers = getInterviewers(appId);
      if (!app || !selected[index]) return safeEphemeral(interaction, 'Question not found.');
      if (!interviewers.includes(interaction.user.id)) return safeEphemeral(interaction, '❌ You are not an assigned interviewer.');

      db.prepare(`
        INSERT INTO scores(app_id, staff_id, question_key, score)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(app_id, staff_id, question_key) DO UPDATE SET score = excluded.score
      `).run(appId, interaction.user.id, selected[index].key, score);

      db.prepare(`
        INSERT INTO score_sessions(app_id, staff_id, current_index, finished)
        VALUES(?, ?, ?, 0)
        ON CONFLICT(app_id, staff_id) DO UPDATE SET current_index = excluded.current_index
      `).run(appId, interaction.user.id, index);

      if (app.mode === 'test') markTestCheck('scoring');
      return interaction.update({ embeds: [scoringEmbed(app, interaction.user.id)], components: scoringRows(app, interaction.user.id) });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('score_prev:') || interaction.customId.startsWith('score_next:'))) {
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');
      const interviewers = getInterviewers(appId);
      if (!interviewers.includes(interaction.user.id)) return safeEphemeral(interaction, '❌ You are not an assigned interviewer.');

      let session = db.prepare('SELECT * FROM score_sessions WHERE app_id = ? AND staff_id = ?').get(appId, interaction.user.id);
      if (!session) {
        db.prepare('INSERT INTO score_sessions(app_id, staff_id, current_index, finished) VALUES(?, ?, 0, 0)').run(appId, interaction.user.id);
        session = { current_index: 0 };
      }
      const selected = getSelectedQuestions(app);
      const delta = interaction.customId.startsWith('score_next:') ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(selected.length - 1, session.current_index + delta));
      db.prepare('UPDATE score_sessions SET current_index = ? WHERE app_id = ? AND staff_id = ?').run(nextIndex, appId, interaction.user.id);
      if (app.mode === 'test') markTestCheck('navigation');
      return interaction.update({ embeds: [scoringEmbed(app, interaction.user.id)], components: scoringRows(app, interaction.user.id) });
    }

    if (interaction.isButton() && interaction.customId.startsWith('score_finish:')) {
      const appId = Number(interaction.customId.split(':')[1]);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');
      const interviewers = getInterviewers(appId);
      if (!interviewers.includes(interaction.user.id)) return safeEphemeral(interaction, '❌ You are not an assigned interviewer.');
      const total = interviewerScore(appId, interaction.user.id);
      if (total.count !== 21) return safeEphemeral(interaction, `❌ You have only scored **${total.count}/21** questions. Score every question first.`);

      db.prepare(`
        INSERT INTO score_sessions(app_id, staff_id, current_index, finished)
        VALUES(?, ?, 20, 1)
        ON CONFLICT(app_id, staff_id) DO UPDATE SET finished = 1
      `).run(appId, interaction.user.id);

      if (app.mode === 'test' && interviewers.length >= 2) {
        const completed = interviewers.filter(id => db.prepare('SELECT finished FROM score_sessions WHERE app_id = ? AND staff_id = ?').get(appId, id)?.finished === 1);
        if (completed.length >= 2) markTestCheck('two_interviewer_scoring');
      }

      return interaction.update({
        content: `✅ Your scorecard is finished. Final score: **${total.total}/63** (${((total.total / 63) * 100).toFixed(1)}%)`,
        embeds: [],
        components: [],
      });
    }

    // ---------------- End interview ----------------
    if (interaction.isButton() && interaction.customId.startsWith('end_interview:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_end:${appId}`).setLabel('Yes — End Interview').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_end:${appId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({ content: '🏁 Are you sure you want to end this interview?', components: [row], flags: MessageFlags.Ephemeral });
    }

    if (interaction.isButton() && interaction.customId.startsWith('confirm_end:')) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const appId = Number(interaction.customId.split(':')[1]);
      await interaction.deferUpdate();
      try {
        await endInterview(appId, guild);
        return interaction.editReply({ content: '✅ Interview ended and results were posted.', components: [] });
      } catch (error) {
        return interaction.editReply({ content: `❌ ${error.message}`, components: [] });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith('cancel_end:')) {
      return interaction.update({ content: 'Interview continues.', components: [] });
    }

    // ---------------- Final decision ----------------
    if (interaction.isButton() && /^final_(accept|reject|review):/.test(interaction.customId)) {
      if (!isAuthorizedStaff(member)) return safeEphemeral(interaction, '❌ Staff only.');
      const [actionPart, appIdRaw] = interaction.customId.split(':');
      const appId = Number(appIdRaw);
      const app = getApplication(appId);
      if (!app) return safeEphemeral(interaction, 'Application not found.');

      const action = actionPart.replace('final_', '');
      const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'further_review';
      db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, appId);
      await postSubmittedApplication(appId);

      if (app.mode === 'test') markTestCheck('final_decision');

      const user = await client.users.fetch(app.user_id).catch(() => null);
      if (user) {
        let message = '';
        if (app.mode === 'test') {
          message = `🧪 TEST RESULT: Your test application was marked **${statusLabel(status)}**. No real staff role was changed.`;
        } else if (status === 'accepted') {
          message = '✅ Your Crafted SMP staff application was **accepted**! A staff leader will handle your staff role/onboarding.';
        } else if (status === 'rejected') {
          message = '❌ Your Crafted SMP staff application was **not accepted** at this time.';
        } else {
          message = '🟡 Your Crafted SMP staff application is under **further review**.';
        }
        await user.send(message).catch(() => null);
      }

      return safeEphemeral(interaction, `✅ Application marked as **${statusLabel(status)}**.${app.mode === 'test' ? ' This was only a test.' : ''}`);
    }

  } catch (error) {
    console.error('Interaction error:', error);
    await safeEphemeral(interaction, `❌ Something went wrong: ${error.message}`);
  }
});

client.login(DISCORD_TOKEN);
