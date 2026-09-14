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
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events,
  MessageFlags,
} = require('discord.js');

const Database = require('better-sqlite3');
const { DateTime } = require('luxon');

// =====================================================
// CRAFTED SMP STAFF APPLICATION BOT
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
  console.error('❌ DISCORD_TOKEN is missing.');
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
  interview_ts INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'PENDING',
  status TEXT NOT NULL DEFAULT 'choosing_time',
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

// =====================================================
// SETTINGS
// =====================================================

function getSetting(key, fallback = null) {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key);

  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

if (!getSetting('system_mode')) {
  setSetting('system_mode', 'closed');
}

// =====================================================
// TEST CHECKLIST
// =====================================================

const TEST_CHECKS = [
  ['application_panel', 'Application panel'],
  ['application_form', 'Application form'],
  ['application_submission', 'Application submission'],
  ['staff_approvals', 'Staff approvals'],
  ['owner_override', 'Owner/Co-Owner override'],
  ['rescheduling', 'Rescheduling'],
  ['timezone_conversion', 'Time-zone conversion'],
  ['applicant_confirmation', 'Applicant confirmation'],
  ['interview_reminders', 'Interview reminders'],
  ['private_text_permissions', 'Private text permissions'],
  ['voice_permissions', 'Voice permissions'],
  ['random_questions', 'Random question selection'],
  ['scoring', '0–3 scoring'],
  ['two_interviewer_scoring', 'Two interviewer scoring'],
  ['navigation', 'Previous/Next navigation'],
  ['restart_persistence', 'Restart persistence'],
  ['score_calculations', 'Score calculations'],
  ['end_interview', 'End Interview'],
  ['final_decision', 'Accept/Reject/Further Review'],
  ['test_cleanup', 'Test cleanup'],
];

function markTestCheck(key) {
  if (!TEST_CHECKS.some(([k]) => k === key)) return;

  db.prepare(`
    INSERT INTO test_checks(
      check_key,
      passed,
      updated_at
    )
    VALUES(?, 1, ?)
    ON CONFLICT(check_key)
    DO UPDATE SET
      passed = 1,
      updated_at = excluded.updated_at
  `).run(key, Date.now());
}

function resetTestChecks() {
  db.prepare('DELETE FROM test_checks').run();
}

function checklistText() {
  const rows = db
    .prepare(`
      SELECT check_key
      FROM test_checks
      WHERE passed = 1
    `)
    .all();

  const passed = new Set(
    rows.map(row => row.check_key)
  );

  const list = TEST_CHECKS.map(
    ([key, label]) =>
      `${passed.has(key) ? '✅' : '⬜'} ${label}`
  );

  const count = TEST_CHECKS.filter(
    ([key]) => passed.has(key)
  ).length;

  return [
    ...list,
    '',
    `**Testing Progress: ${count}/${TEST_CHECKS.length}**`,
    count === TEST_CHECKS.length
      ? '✅ **ALL SYSTEMS TESTED**'
      : '',
  ].join('\n');
}

// =====================================================
// QUESTIONS
// 3 RANDOM QUESTIONS FROM EACH CATEGORY
// 3 POINTS EACH
// 21 QUESTIONS TOTAL
// 63 POINTS PER INTERVIEWER
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
      'As a moderator you contain a role of leadership and persuasion. Without breaking character, persuade us why ketchup should be a soup.',
      'As being persuasive, explain why noodles should be on a pizza.',
      'Explain how coffee can be a type of tea.',
    ],
  },
];

function randomThreePerCategory() {
  const result = [];

  QUESTION_CATEGORIES.forEach(
    (category, categoryIndex) => {
      const indexes = category.questions.map(
        (_, index) => index
      );

      for (
        let i = indexes.length - 1;
        i > 0;
        i--
      ) {
        const random =
          Math.floor(
            Math.random() * (i + 1)
          );

        [
          indexes[i],
          indexes[random],
        ] = [
          indexes[random],
          indexes[i],
        ];
      }

      indexes
        .slice(0, 3)
        .forEach(questionIndex => {
          result.push({
            key:
              `${categoryIndex}:${questionIndex}`,

            categoryIndex,

            questionIndex,

            category:
              category.name,

            question:
              category.questions[
                questionIndex
              ],
          });
        });
    }
  );

  return result;
}

// =====================================================
// TIME / DATE SCROLL PICKERS
// =====================================================

const DATE_PAGE_SIZE = 14;
const MAX_DATE_PAGES = 12;

const TIME_OPTIONS = [
  ['08:00', '8:00 AM'],
  ['08:30', '8:30 AM'],
  ['09:00', '9:00 AM'],
  ['09:30', '9:30 AM'],
  ['10:00', '10:00 AM'],
  ['10:30', '10:30 AM'],
  ['11:00', '11:00 AM'],
  ['11:30', '11:30 AM'],
  ['12:00', '12:00 PM'],
  ['12:30', '12:30 PM'],
  ['13:00', '1:00 PM'],
  ['13:30', '1:30 PM'],
  ['14:00', '2:00 PM'],
  ['14:30', '2:30 PM'],
  ['15:00', '3:00 PM'],
  ['15:30', '3:30 PM'],
  ['16:00', '4:00 PM'],
  ['16:30', '4:30 PM'],
  ['17:00', '5:00 PM'],
  ['17:30', '5:30 PM'],
  ['18:00', '6:00 PM'],
  ['18:30', '6:30 PM'],
  ['19:00', '7:00 PM'],
  ['19:30', '7:30 PM'],
  ['20:00', '8:00 PM'],
];

const TIMEZONE_OPTIONS = [
  {
    label: 'HST — Hawaii',
    value: 'HST',
    description:
      'Hawaii Standard Time',
  },

  {
    label: 'PST/PDT — Pacific',
    value: 'PACIFIC',
    description:
      'Pacific Time',
  },

  {
    label: 'MST/MDT — Mountain',
    value: 'MOUNTAIN',
    description:
      'Mountain Time',
  },

  {
    label: 'CST/CDT — Central',
    value: 'CENTRAL',
    description:
      'Central Time',
  },

  {
    label: 'EST/EDT — Eastern',
    value: 'EASTERN',
    description:
      'Eastern Time',
  },
];

const TIMEZONE_ZONES = {
  HST:
    'Pacific/Honolulu',

  PACIFIC:
    'America/Los_Angeles',

  MOUNTAIN:
    'America/Denver',

  CENTRAL:
    'America/Chicago',

  EASTERN:
    'America/New_York',
};

function minimumSelectableDate(app) {
  const today = DateTime
    .now()
    .setZone(
      'Pacific/Honolulu'
    )
    .startOf('day');

  if (app.mode === 'real') {
    return today.plus({
      days: 7,
    });
  }

  return today;
}

function buildDatePicker(app, page = 0) {
  page = Math.max(
    0,
    Math.min(
      MAX_DATE_PAGES - 1,
      Number(page) || 0
    )
  );

  const start =
    minimumSelectableDate(app)
      .plus({
        days:
          page *
          DATE_PAGE_SIZE,
      });

  const options = [];

  for (
    let i = 0;
    i < DATE_PAGE_SIZE;
    i++
  ) {
    const date =
      start.plus({
        days: i,
      });

    options.push({
      label:
        date.toFormat(
          'cccc, LLLL d'
        ),

      description:
        date.toFormat(
          'yyyy'
        ),

      value:
        date.toISODate(),
    });
  }

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_date:${app.id}:${page}`
      )
      .setPlaceholder(
        `Choose date — page ${page + 1}`
      )
      .addOptions(
        options
      );

  return {
    content: [
      '📅 **Choose your interview date**',
      '',
      app.mode === 'real'
        ? 'Only dates at least **7 days from today** are available.'
        : 'Testing Mode allows today or future dates.',
      '',
      'Tap the menu and scroll/swipe through the dates.',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `date_page:${app.id}:${page - 1}`
            )
            .setLabel(
              'Previous Dates'
            )
            .setEmoji('⬅️')
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(
              page === 0
            ),

          new ButtonBuilder()
            .setCustomId(
              `date_page:${app.id}:${page + 1}`
            )
            .setLabel(
              'Newer Dates'
            )
            .setEmoji('➡️')
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(
              page >=
              MAX_DATE_PAGES - 1
            )
        ),
    ],
  };
}

function buildTimePicker(
  app,
  dateISO
) {
  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_time:${app.id}:${dateISO}`
      )
      .setPlaceholder(
        'Choose interview time'
      )
      .addOptions(
        TIME_OPTIONS.map(
          ([value, label]) => ({
            label,
            value,
          })
        )
      );

  return {
    content: [
      `📅 **Date:** ${DateTime.fromISO(dateISO).toFormat('cccc, LLLL d, yyyy')}`,
      '',
      '🕐 **Choose your interview time**',
      '',
      'Tap the menu and scroll/swipe through the times.',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `back_to_dates:${app.id}`
            )
            .setLabel(
              'Change Date'
            )
            .setEmoji('⬅️')
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  };
}

function buildTimezonePicker(
  app,
  dateISO,
  timeValue
) {
  const friendly =
    TIME_OPTIONS.find(
      ([value]) =>
        value === timeValue
    )?.[1] ||
    timeValue;

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_timezone:${app.id}:${dateISO}:${timeValue}`
      )
      .setPlaceholder(
        'Choose your time zone'
      )
      .addOptions(
        TIMEZONE_OPTIONS
      );

  return {
    content: [
      `📅 **Date:** ${DateTime.fromISO(dateISO).toFormat('cccc, LLLL d, yyyy')}`,
      `🕐 **Time:** ${friendly}`,
      '',
      '🌎 **Choose your time zone**',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `back_to_times:${app.id}:${dateISO}`
            )
            .setLabel(
              'Change Time'
            )
            .setEmoji('⬅️')
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  };
}

function selectedDateTimeToUnix(
  dateISO,
  timeValue,
  timezoneValue
) {
  const zone =
    TIMEZONE_ZONES[
      timezoneValue
    ];

  if (!zone) {
    return null;
  }

  const dt =
    DateTime.fromISO(
      `${dateISO}T${timeValue}:00`,
      {
        zone,
      }
    );

  if (!dt.isValid) {
    return null;
  }

  return {
    timestamp:
      Math.floor(
        dt.toSeconds()
      ),

    timezone:
      timezoneValue,
  };
}

// =====================================================
// GENERAL HELPERS
// =====================================================

function unixNow() {
  return Math.floor(
    Date.now() / 1000
  );
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        '-'
      )
      .replace(
        /^-+|-+$/g,
        ''
      )
      .slice(
        0,
        70
      ) ||
    'applicant'
  );
}

function statusLabel(status) {
  const statuses = {
    choosing_time:
      '📅 Choosing Interview Time',

    pending:
      '🟡 Pending Review',

    needs_time:
      '🟠 Needs Different Time',

    needs_interviewer:
      '🟠 Needs Interviewer',

    confirmed:
      '🟢 Interview Confirmed',

    rejected:
      '🔴 Rejected',

    in_progress:
      '🔵 Interview In Progress',

    completed:
      '✅ Interview Completed',

    accepted:
      '✅ Accepted',

    further_review:
      '🟡 Further Review',
  };

  return (
    statuses[status] ||
    status
  );
}

function isOwner(member) {
  return Boolean(
    member?.roles?.cache?.has(
      OWNER_ROLE_ID
    )
  );
}

function isCoOwner(member) {
  return Boolean(
    member?.roles?.cache?.has(
      CO_OWNER_ROLE_ID
    )
  );
}

function isSenior(member) {
  return Boolean(
    member?.roles?.cache?.has(
      SENIOR_STAFF_ROLE_ID
    )
  );
}

function isAuthorizedStaff(
  member
) {
  return (
    isOwner(member) ||
    isCoOwner(member) ||
    isSenior(member)
  );
}

function isOwnerOrCoOwner(
  member
) {
  return (
    isOwner(member) ||
    isCoOwner(member)
  );
}

async function safeReply(
  interaction,
  content
) {
  if (
    interaction.replied ||
    interaction.deferred
  ) {
    return interaction
      .followUp({
        content,
        flags:
          MessageFlags.Ephemeral,
      })
      .catch(() => null);
  }

  return interaction
    .reply({
      content,
      flags:
        MessageFlags.Ephemeral,
    })
    .catch(() => null);
}

async function getTextChannel(id) {
  const channel =
    await client.channels
      .fetch(id)
      .catch(() => null);

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return null;
  }

  return channel;
}

function getApplication(appId) {
  return db
    .prepare(`
      SELECT *
      FROM applications
      WHERE id = ?
    `)
    .get(appId);
}

function getActiveApplication(
  userId,
  mode
) {
  return db
    .prepare(`
      SELECT *
      FROM applications
      WHERE user_id = ?
        AND mode = ?
        AND status NOT IN(
          'rejected',
          'accepted',
          'completed'
        )
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(
      userId,
      mode
    );
}

function getApprovals(appId) {
  return db
    .prepare(`
      SELECT staff_id
      FROM approvals
      WHERE app_id = ?
      ORDER BY created_at
    `)
    .all(appId)
    .map(
      row =>
        row.staff_id
    );
}

function getInterviewers(
  appId
) {
  return db
    .prepare(`
      SELECT staff_id
      FROM interviewers
      WHERE app_id = ?
    `)
    .all(appId)
    .map(
      row =>
        row.staff_id
    );
}

function getQuestions(app) {
  try {
    return app.selected_questions
      ? JSON.parse(
          app.selected_questions
        )
      : [];
  } catch {
    return [];
  }
}

function saveQuestions(
  appId,
  questions
) {
  db.prepare(`
    UPDATE applications
    SET selected_questions = ?
    WHERE id = ?
  `).run(
    JSON.stringify(
      questions
    ),
    appId
  );
}

function privateTextPermissions(
  guild,
  applicantId = null
) {
  const permissions = [
    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
    },

    {
      id:
        OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        CO_OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        SENIOR_STAFF_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (applicantId) {
    permissions.push({
      id:
        applicantId,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return permissions;
}

// =====================================================
// MANAGEMENT PANEL
// =====================================================

function managementEmbed() {
  const mode =
    getSetting(
      'system_mode',
      'closed'
    );

  let state =
    '🔴 Applications Closed';

  if (mode === 'test') {
    state =
      '🧪 Testing Mode';
  }

  if (mode === 'public') {
    state =
      '🟢 Public Applications Open';
  }

  return new EmbedBuilder()
    .setTitle(
      '🛡️ Crafted SMP Staff Applications'
    )
    .setDescription([
      `**Status:** ${state}`,
      '',
      '🧪 Test everything privately first.',
      '',
      '🚀 Owner or Co-Owner can open real applications after testing.',
    ].join('\n'));
}

function managementComponents() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'test_mode'
          )
          .setLabel(
            'Testing Mode'
          )
          .setEmoji('🧪')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            'choose_test_applicant'
          )
          .setLabel(
            'Choose Test Applicant'
          )
          .setEmoji('👤')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            'test_checklist'
          )
          .setLabel(
            'Test Checklist'
          )
          .setEmoji('📋')
          .setStyle(
            ButtonStyle.Secondary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'open_public'
          )
          .setLabel(
            'Enable Public Applications'
          )
          .setEmoji('🚀')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            'close_apps'
          )
          .setLabel(
            'Close Applications'
          )
          .setEmoji('🔴')
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            'reset_test'
          )
          .setLabel(
            'Reset Test'
          )
          .setEmoji('🗑️')
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

async function ensureManagementPanel() {
  const channel =
    await getTextChannel(
      APPLICATION_CONTROL_CHANNEL_ID
    );

  if (!channel) {
    throw new Error(
      'Application control channel not found.'
    );
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 30,
      })
      .catch(() => null);

  const existing =
    messages?.find(
      message =>
        message.author.id ===
          client.user.id &&
        message.components.some(
          row =>
            row.components.some(
              component =>
                component.customId ===
                'test_mode'
            )
        )
    );

  if (existing) {
    await existing.edit({
      embeds: [
        managementEmbed(),
      ],

      components:
        managementComponents(),
    });

    return;
  }

  await channel.send({
    embeds: [
      managementEmbed(),
    ],

    components:
      managementComponents(),
  });
}

// =====================================================
// APPLICATION PANEL
// =====================================================

function applicationPanelEmbed(
  testMode
) {
  return new EmbedBuilder()
    .setTitle(
      testMode
        ? '🧪 TEST Staff Application'
        : '🛡️ Crafted SMP Staff Application'
    )
    .setDescription([
      testMode
        ? '**This application is only for testing.**'
        : '**Staff applications are open.**',

      '',

      '**Application process:**',

      '1️⃣ Enter your age and moderation experience.',

      '2️⃣ Scroll/select your interview date.',

      '3️⃣ Scroll/select your interview time.',

      '4️⃣ Select your time zone.',

      '',

      '📱 On mobile you can swipe through the Discord selection list.',

      '',

      testMode
        ? '⚡ Staff can also use **Start Test Interview Now**.'
        : '📅 Real interviews must be at least **7 days in advance**.',

      '',

      '📖 Study the Crafted SMP rules before your interview.',
    ].join('\n'));
}

function applyButton(
  testMode
) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          testMode
            ? 'apply_test'
            : 'apply_real'
        )
        .setLabel(
          testMode
            ? 'Submit Test Application'
            : 'Apply for Staff'
        )
        .setEmoji(
          testMode
            ? '🧪'
            : '🛡️'
        )
        .setStyle(
          ButtonStyle.Primary
        )
    );
}

async function createPublicChannel(
  guild
) {
  const oldId =
    getSetting(
      'public_channel_id'
    );

  if (oldId) {
    const old =
      await guild.channels
        .fetch(oldId)
        .catch(() => null);

    if (old) {
      return old;
    }
  }

  const channel =
    await guild.channels.create({
      name:
        'staff-applications',

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites: [
        {
          id:
            guild.roles.everyone.id,

          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],

          deny: [
            PermissionFlagsBits.SendMessages,
          ],
        },
      ],
    });

  await channel.send({
    embeds: [
      applicationPanelEmbed(
        false
      ),
    ],

    components: [
      applyButton(false),
    ],
  });

  setSetting(
    'public_channel_id',
    channel.id
  );

  return channel;
}

async function deletePublicChannel(
  guild
) {
  const id =
    getSetting(
      'public_channel_id'
    );

  if (!id) return;

  const channel =
    await guild.channels
      .fetch(id)
      .catch(() => null);

  if (channel) {
    await channel
      .delete()
      .catch(() => null);
  }

  setSetting(
    'public_channel_id',
    ''
  );
}

async function createTestChannel(
  guild,
  userId
) {
  const member =
    await guild.members
      .fetch(userId)
      .catch(() => null);

  if (!member) {
    throw new Error(
      'Test applicant was not found.'
    );
  }

  const oldId =
    getSetting(
      'test_channel_id'
    );

  if (oldId) {
    const old =
      await guild.channels
        .fetch(oldId)
        .catch(() => null);

    if (old) {
      await old
        .delete()
        .catch(() => null);
    }
  }

  const channel =
    await guild.channels.create({
      name:
        `test-application-${slugify(member.user.username)}`,

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        privateTextPermissions(
          guild,
          userId
        ),
    });

  await channel.send({
    content:
      `<@${userId}>`,

    embeds: [
      applicationPanelEmbed(
        true
      ),
    ],

    components: [
      applyButton(true),
    ],
  });

  setSetting(
    'test_channel_id',
    channel.id
  );

  markTestCheck(
    'application_panel'
  );

  return channel;
}

// =====================================================
// APPLICATION FORM
// =====================================================

function applicationModal(mode) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `application_form:${mode}`
      )
      .setTitle(
        mode === 'test'
          ? 'TEST Staff Application'
          : 'Staff Application'
      );

  const age =
    new TextInputBuilder()
      .setCustomId('age')
      .setLabel(
        'What is your age?'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(true)
      .setMaxLength(20);

  const experience =
    new TextInputBuilder()
      .setCustomId(
        'experience'
      )
      .setLabel(
        'Positive moderation experience'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(age),

    new ActionRowBuilder()
      .addComponents(
        experience
      )
  );

  return modal;
}

// =====================================================
// POST APPLICATION TO STAFF
// =====================================================

async function postApplication(
  appId
) {
  const app =
    getApplication(appId);

  if (!app) return;

  const channel =
    await getTextChannel(
      SUBMITTED_APPLICATIONS_CHANNEL_ID
    );

  if (!channel) {
    throw new Error(
      'Application review channel not found.'
    );
  }

  const approvals =
    getApprovals(app.id);

  const interviewers =
    getInterviewers(app.id);

  const embed =
    new EmbedBuilder()
      .setTitle(
        app.mode === 'test'
          ? '🧪 TEST APPLICATION'
          : '🛡️ Staff Application'
      )
      .addFields(
        {
          name:
            'Applicant',

          value:
            `<@${app.user_id}>`,

          inline:
            true,
        },

        {
          name:
            'Age',

          value:
            app.age,

          inline:
            true,
        },

        {
          name:
            'Status',

          value:
            statusLabel(
              app.status
            ),

          inline:
            true,
        },

        {
          name:
            'Interview',

          value:
            app.interview_ts > 0
              ? `<t:${app.interview_ts}:F>\n<t:${app.interview_ts}:R>`
              : 'Not selected yet',

          inline:
            false,
        },

        {
          name:
            'Time Zone',

          value:
            app.timezone,

          inline:
            true,
        },

        {
          name:
            'Moderation Experience',

          value:
            app.experience.slice(
              0,
              1024
            ),
        },

        {
          name:
            'Approvals',

          value:
            approvals.length
              ? approvals
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join('\n')
              : 'None',

          inline:
            true,
        },

        {
          name:
            'Interviewers',

          value:
            interviewers.length
              ? interviewers
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join('\n')
              : 'Not assigned',

          inline:
            true,
        }
      )
      .setFooter({
        text:
          `Application #${app.id}`,
      });

  if (app.mode === 'test') {
    embed.setDescription(
      '🧪 **THIS IS TEST DATA — NOT A REAL APPLICATION**'
    );
  }

  const rows = [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `approve:${app.id}`
          )
          .setLabel(
            'Approve Interview'
          )
          .setEmoji('✅')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `reschedule:${app.id}`
          )
          .setLabel(
            'Choose Different Time'
          )
          .setEmoji('📅')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `cant_make:${app.id}`
          )
          .setLabel(
            "Can't Make It"
          )
          .setEmoji('❌')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `assign:${app.id}`
          )
          .setLabel(
            'Assign Interviewers'
          )
          .setEmoji('👥')
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];

  if (
    app.mode === 'test' &&
    ![
      'in_progress',
      'completed',
      'accepted',
      'rejected',
    ].includes(app.status)
  ) {
    rows.push(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `test_now:${app.id}`
            )
            .setLabel(
              'Start Test Interview Now'
            )
            .setEmoji('⚡')
            .setStyle(
              ButtonStyle.Danger
            )
        )
    );
  }

  let message = null;

  if (
    app.submission_message_id
  ) {
    message =
      await channel.messages
        .fetch(
          app.submission_message_id
        )
        .catch(() => null);
  }

  if (message) {
    await message.edit({
      embeds: [embed],
      components: rows,
    });
  } else {
    message =
      await channel.send({
        embeds: [embed],
        components: rows,
      });

    db.prepare(`
      UPDATE applications
      SET submission_message_id = ?
      WHERE id = ?
    `).run(
      message.id,
      app.id
    );
  }
}

// =====================================================
// FINALIZE DATE/TIME SELECTION
// =====================================================

async function finishSchedule(
  interaction,
  app,
  dateISO,
  timeValue,
  timezoneValue
) {
  const selected =
    selectedDateTimeToUnix(
      dateISO,
      timeValue,
      timezoneValue
    );

  if (!selected) {
    return safeReply(
      interaction,
      '❌ Could not create that interview time.'
    );
  }

  if (
    app.mode === 'real' &&
    selected.timestamp <
      unixNow() +
        7 *
          24 *
          60 *
          60
  ) {
    return safeReply(
      interaction,
      '❌ Real interviews must be at least 7 days in advance.'
    );
  }

  const rescheduling =
    app.status ===
    'needs_time';

  db.prepare(`
    UPDATE applications
    SET
      interview_ts = ?,
      timezone = ?,
      status = 'pending'
    WHERE id = ?
  `).run(
    selected.timestamp,
    timezoneValue,
    app.id
  );

  if (rescheduling) {
    db.prepare(`
      DELETE FROM approvals
      WHERE app_id = ?
    `).run(
      app.id
    );
  }

  if (app.mode === 'test') {
    markTestCheck(
      'application_submission'
    );

    markTestCheck(
      'timezone_conversion'
    );

    if (rescheduling) {
      markTestCheck(
        'rescheduling'
      );
    }
  }

  await postApplication(
    app.id
  );

  return interaction.update({
    content: [
      '✅ **Interview time selected!**',
      '',
      `<t:${selected.timestamp}:F>`,
      `<t:${selected.timestamp}:R>`,
      '',
      'Discord automatically converts this for each person’s local time.',
      '',
      '📖 Prepare and study the rules before your interview.',
    ].join('\n'),

    components: [],
  });
}

// =====================================================
// CONFIRM INTERVIEW
// =====================================================

async function confirmInterview(
  appId,
  guild
) {
  let app =
    getApplication(appId);

  if (!app) return;

  if (
    [
      'confirmed',
      'in_progress',
      'completed',
    ].includes(
      app.status
    )
  ) {
    return;
  }

  let questions =
    getQuestions(app);

  if (!questions.length) {
    questions =
      randomThreePerCategory();

    saveQuestions(
      app.id,
      questions
    );

    if (app.mode === 'test') {
      markTestCheck(
        'random_questions'
      );
    }
  }

  const applicant =
    await guild.members
      .fetch(app.user_id)
      .catch(() => null);

  const username =
    applicant?.user?.username ||
    'applicant';

  let channel =
    app.interview_text_channel_id
      ? await guild.channels
          .fetch(
            app.interview_text_channel_id
          )
          .catch(() => null)
      : null;

  if (!channel) {
    channel =
      await guild.channels.create({
        name:
          `interview-${slugify(username)}`,

        type:
          ChannelType.GuildText,

        parent:
          MAIN_CATEGORY_ID,

        permissionOverwrites:
          privateTextPermissions(
            guild,
            app.user_id
          ),
      });

    db.prepare(`
      UPDATE applications
      SET interview_text_channel_id = ?
      WHERE id = ?
    `).run(
      channel.id,
      app.id
    );

    if (app.mode === 'test') {
      markTestCheck(
        'private_text_permissions'
      );
    }
  }

  db.prepare(`
    UPDATE applications
    SET status = 'confirmed'
    WHERE id = ?
  `).run(app.id);

  app =
    getApplication(app.id);

  const interviewers =
    getInterviewers(
      app.id
    );

  const controls = [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `start_interview:${app.id}`
          )
          .setLabel(
            'Start Interview'
          )
          .setEmoji('🎙️')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `end_interview:${app.id}`
          )
          .setLabel(
            'End Interview'
          )
          .setEmoji('🏁')
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];

  if (app.mode === 'test') {
    controls.push(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `reminder:${app.id}:24`
            )
            .setLabel(
              'Simulate 24h'
            )
            .setStyle(
              ButtonStyle.Secondary
            ),

          new ButtonBuilder()
            .setCustomId(
              `reminder:${app.id}:1`
            )
            .setLabel(
              'Simulate 1h'
            )
            .setStyle(
              ButtonStyle.Secondary
            ),

          new ButtonBuilder()
            .setCustomId(
              `reminder:${app.id}:10`
            )
            .setLabel(
              'Simulate 10m'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
        )
    );
  }

  await channel.send({
    content: [
      `<@${app.user_id}>`,
      ...interviewers.map(
        id =>
          `<@${id}>`
      ),
    ].join(' '),

    embeds: [
      new EmbedBuilder()
        .setTitle(
          app.mode === 'test'
            ? '🧪 TEST Interview Confirmed'
            : '✅ Staff Interview Confirmed'
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          '',
          `**Interview:** <t:${app.interview_ts}:F>`,
          '',
          `**Interviewers:** ${
            interviewers.length
              ? interviewers
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(', ')
              : 'Not assigned'
          }`,
          '',
          '📖 Study the Crafted SMP rules before the interview.',
        ].join('\n')),
    ],

    components:
      controls,
  });

  const user =
    await client.users
      .fetch(
        app.user_id
      )
      .catch(() => null);

  if (user) {
    await user
      .send(
        [
          app.mode === 'test'
            ? '🧪 **TEST Interview Confirmed**'
            : '✅ **Your Crafted SMP Staff Interview is Confirmed!**',

          '',

          `<t:${app.interview_ts}:F>`,

          '',

          '📖 Study the server rules before the interview.',
        ].join('\n')
      )
      .catch(() => null);
  }

  if (app.mode === 'test') {
    markTestCheck(
      'applicant_confirmation'
    );
  }

  await postApplication(
    app.id
  );
}

// =====================================================
// REMINDERS
// =====================================================

async function sendReminder(
  app,
  label
) {
  const channel =
    await getTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (!channel) return;

  const interviewers =
    getInterviewers(
      app.id
    );

  await channel.send({
    content:
      interviewers
        .map(
          id =>
            `<@${id}>`
        )
        .join(' '),

    embeds: [
      new EmbedBuilder()
        .setTitle(
          `⏰ Interview Reminder — ${label}`
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          `**Interview:** <t:${app.interview_ts}:F>`,
          `**Starts:** <t:${app.interview_ts}:R>`,
        ].join('\n')),
    ],
  });

  if (app.mode === 'test') {
    markTestCheck(
      'interview_reminders'
    );
  }
}

async function reminderCheck() {
  const apps =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'real'
        AND status = 'confirmed'
    `).all();

  const now =
    unixNow();

  const schedules = [
    {
      key: '24h',
      difference:
        24 * 60 * 60,
      label:
        '24 Hours',
    },

    {
      key: '1h',
      difference:
        60 * 60,
      label:
        '1 Hour',
    },

    {
      key: '10m',
      difference:
        10 * 60,
      label:
        '10 Minutes',
    },
  ];

  for (const app of apps) {
    for (
      const item
      of schedules
    ) {
      const remaining =
        app.interview_ts -
        now;

      if (
        Math.abs(
          remaining -
          item.difference
        ) > 70
      ) {
        continue;
      }

      const already =
        db.prepare(`
          SELECT 1
          FROM reminders
          WHERE app_id = ?
            AND reminder_key = ?
        `).get(
          app.id,
          item.key
        );

      if (already) continue;

      await sendReminder(
        app,
        item.label
      );

      db.prepare(`
        INSERT INTO reminders(
          app_id,
          reminder_key,
          sent_at
        )
        VALUES(?, ?, ?)
      `).run(
        app.id,
        item.key,
        Date.now()
      );
    }
  }
}

// =====================================================
// START INTERVIEW
// =====================================================

async function createScoringChannel(
  app,
  guild
) {
  let channel =
    app.scoring_channel_id
      ? await guild.channels
          .fetch(
            app.scoring_channel_id
          )
          .catch(() => null)
      : null;

  if (channel) {
    return channel;
  }

  const applicant =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(() => null);

  channel =
    await guild.channels.create({
      name:
        `score-${slugify(applicant?.user?.username || 'applicant')}`,

      type:
        ChannelType.GuildText,

      parent:
        SENIOR_STAFF_CATEGORY_ID,

      permissionOverwrites:
        privateTextPermissions(
          guild
        ),
    });

  db.prepare(`
    UPDATE applications
    SET scoring_channel_id = ?
    WHERE id = ?
  `).run(
    channel.id,
    app.id
  );

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '🛡️ Trial Moderator Promotion Board'
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          '',
          'Each staff interviewer scores independently.',
          '',
          '**21 questions total.**',
          '**3 points per question.**',
          '**63 maximum points per interviewer.**',
          '',
          'Click below to open your private scorecard.',
        ].join('\n')),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `scorecard:${app.id}`
            )
            .setLabel(
              'Open My Scorecard'
            )
            .setEmoji('⭐')
            .setStyle(
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `end_interview:${app.id}`
            )
            .setLabel(
              'End Interview'
            )
            .setEmoji('🏁')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ],
  });

  return channel;
}

async function startInterview(
  appId,
  guild,
  staffId
) {
  let app =
    getApplication(appId);

  if (!app) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    app.status ===
    'in_progress'
  ) {
    throw new Error(
      'Interview already started.'
    );
  }

  db.prepare(`
    INSERT OR IGNORE INTO interviewers(
      app_id,
      staff_id
    )
    VALUES(?, ?)
  `).run(
    app.id,
    staffId
  );

  let questions =
    getQuestions(app);

  if (!questions.length) {
    questions =
      randomThreePerCategory();

    saveQuestions(
      app.id,
      questions
    );
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  let voice =
    app.interview_voice_channel_id
      ? await guild.channels
          .fetch(
            app.interview_voice_channel_id
          )
          .catch(() => null)
      : null;

  if (!voice) {
    const applicant =
      await guild.members
        .fetch(
          app.user_id
        )
        .catch(() => null);

    voice =
      await guild.channels.create({
        name:
          `Interview - ${applicant?.user?.username || 'Applicant'}`,

        type:
          ChannelType.GuildVoice,

        parent:
          MAIN_CATEGORY_ID,

        permissionOverwrites: [
          {
            id:
              guild.roles.everyone.id,

            deny: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
            ],
          },

          {
            id:
              app.user_id,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },

          {
            id:
              OWNER_ROLE_ID,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },

          {
            id:
              CO_OWNER_ROLE_ID,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },

          {
            id:
              SENIOR_STAFF_ROLE_ID,

            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
        ],
      });

    db.prepare(`
      UPDATE applications
      SET interview_voice_channel_id = ?
      WHERE id = ?
    `).run(
      voice.id,
      app.id
    );

    if (app.mode === 'test') {
      markTestCheck(
        'voice_permissions'
      );
    }
  }

  db.prepare(`
    UPDATE applications
    SET status = 'in_progress'
    WHERE id = ?
  `).run(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  await createScoringChannel(
    app,
    guild
  );

  await postApplication(
    app.id
  );
}

// =====================================================
// SCORECARD
// =====================================================

function getScoreSession(
  appId,
  staffId
) {
  let session =
    db.prepare(`
      SELECT *
      FROM score_sessions
      WHERE app_id = ?
        AND staff_id = ?
    `).get(
      appId,
      staffId
    );

  if (!session) {
    db.prepare(`
      INSERT INTO score_sessions(
        app_id,
        staff_id,
        current_index,
        finished
      )
      VALUES(?, ?, 0, 0)
    `).run(
      appId,
      staffId
    );

    session = {
      current_index: 0,
      finished: 0,
    };
  }

  return session;
}

function scorecardEmbed(
  app,
  staffId
) {
  const questions =
    getQuestions(app);

  const session =
    getScoreSession(
      app.id,
      staffId
    );

  const index =
    Math.max(
      0,
      Math.min(
        questions.length - 1,
        session.current_index
      )
    );

  const question =
    questions[index];

  if (!question) {
    return new EmbedBuilder()
      .setTitle(
        'No questions available.'
      );
  }

  const savedScore =
    db.prepare(`
      SELECT score
      FROM scores
      WHERE app_id = ?
        AND staff_id = ?
        AND question_key = ?
    `).get(
      app.id,
      staffId,
      question.key
    );

  const progress =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM scores
      WHERE app_id = ?
        AND staff_id = ?
    `).get(
      app.id,
      staffId
    );

  return new EmbedBuilder()
    .setTitle(
      '⭐ Interview Scorecard'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      `**Category:** ${question.category}`,
      '',
      `**Question ${index + 1}/21**`,
      '',
      question.question,
      '',
      `**Current score:** ${
        savedScore
          ? `${savedScore.score}/3`
          : 'Not scored'
      }`,
      '',
      `**Progress:** ${progress.count}/21`,
      '',
      '3/3 = Excellent',
      '2/3 = Good',
      '1/3 = Weak',
      '0/3 = Failed / no answer',
    ].join('\n'));
}

function scorecardComponents(
  app,
  staffId
) {
  const questions =
    getQuestions(app);

  const session =
    getScoreSession(
      app.id,
      staffId
    );

  const index =
    Math.max(
      0,
      Math.min(
        questions.length - 1,
        session.current_index
      )
    );

  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `score:${app.id}:${index}:0`
          )
          .setLabel('0/3')
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `score:${app.id}:${index}:1`
          )
          .setLabel('1/3')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `score:${app.id}:${index}:2`
          )
          .setLabel('2/3')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `score:${app.id}:${index}:3`
          )
          .setLabel('3/3')
          .setStyle(
            ButtonStyle.Success
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `previous_question:${app.id}`
          )
          .setLabel(
            'Previous'
          )
          .setEmoji('⬅️')
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            index === 0
          ),

        new ButtonBuilder()
          .setCustomId(
            `next_question:${app.id}`
          )
          .setLabel(
            'Next'
          )
          .setEmoji('➡️')
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            index >=
            questions.length - 1
          ),

        new ButtonBuilder()
          .setCustomId(
            `finish_score:${app.id}`
          )
          .setLabel(
            'Finish Scoring'
          )
          .setEmoji('✅')
          .setStyle(
            ButtonStyle.Success
          )
      ),
  ];
}

function interviewerTotal(
  appId,
  staffId
) {
  return db
    .prepare(`
      SELECT
        COALESCE(
          SUM(score),
          0
        ) AS total,
        COUNT(*) AS count
      FROM scores
      WHERE app_id = ?
        AND staff_id = ?
    `)
    .get(
      appId,
      staffId
    );
}

function allInterviewersFinished(
  appId
) {
  const interviewers =
    getInterviewers(
      appId
    );

  if (!interviewers.length) {
    return false;
  }

  return interviewers.every(
    staffId => {
      const row =
        db.prepare(`
          SELECT finished
          FROM score_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).get(
          appId,
          staffId
        );

      return (
        row?.finished === 1
      );
    }
  );
}

// =====================================================
// RESULTS
// =====================================================

function categoryScores(
  app,
  staffId
) {
  const questions =
    getQuestions(app);

  return QUESTION_CATEGORIES.map(
    (
      category,
      categoryIndex
    ) => {
      const selected =
        questions.filter(
          question =>
            question.categoryIndex ===
            categoryIndex
        );

      let total = 0;

      for (
        const question
        of selected
      ) {
        const row =
          db.prepare(`
            SELECT score
            FROM scores
            WHERE app_id = ?
              AND staff_id = ?
              AND question_key = ?
          `).get(
            app.id,
            staffId,
            question.key
          );

        total +=
          row?.score || 0;
      }

      return {
        name:
          category.name,

        score:
          total,
      };
    }
  );
}

async function postResults(
  appId
) {
  const app =
    getApplication(
      appId
    );

  const channel =
    await getTextChannel(
      INTERVIEW_RESULTS_CHANNEL_ID
    );

  if (
    !app ||
    !channel
  ) {
    return;
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  let combined = 0;

  const fields = [];

  for (
    const staffId
    of interviewers
  ) {
    const total =
      interviewerTotal(
        app.id,
        staffId
      );

    combined +=
      total.total;

    fields.push({
      name:
        `Interviewer <@${staffId}>`,

      value:
        `**${total.total}/63** — ${((total.total / 63) * 100).toFixed(1)}%`,
    });

    fields.push({
      name:
        'Category Scores',

      value:
        categoryScores(
          app,
          staffId
        )
          .map(
            item =>
              `${item.name}: **${item.score}/9**`
          )
          .join('\n'),
    });
  }

  const combinedMax =
    63 *
    Math.max(
      1,
      interviewers.length
    );

  const percentage =
    combinedMax
      ? (
          combined /
          combinedMax *
          100
        ).toFixed(1)
      : '0.0';

  fields.push({
    name:
      'Combined Result',

    value:
      `**${combined}/${combinedMax}**\n**${percentage}%**`,
  });

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          app.mode === 'test'
            ? '🧪 TEST RESULTS — NOT REAL'
            : '🛡️ Crafted SMP Staff Interview Results'
        )
        .setDescription(
          `**Applicant:** <@${app.user_id}>`
        )
        .addFields(
          fields
        ),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `accept:${app.id}`
            )
            .setLabel(
              'Accept Applicant'
            )
            .setEmoji('✅')
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `reject:${app.id}`
            )
            .setLabel(
              'Reject Applicant'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            ),

          new ButtonBuilder()
            .setCustomId(
              `review:${app.id}`
            )
            .setLabel(
              'Further Review'
            )
            .setEmoji('🟡')
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  });

  if (app.mode === 'test') {
    markTestCheck(
      'score_calculations'
    );
  }
}

// =====================================================
// END INTERVIEW
// =====================================================

async function finishInterview(
  appId,
  guild
) {
  const app =
    getApplication(
      appId
    );

  if (!app) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    !allInterviewersFinished(
      app.id
    )
  ) {
    throw new Error(
      'Every assigned interviewer must finish all 21 questions first.'
    );
  }

  if (
    app.interview_voice_channel_id
  ) {
    const voice =
      await guild.channels
        .fetch(
          app.interview_voice_channel_id
        )
        .catch(() => null);

    if (voice) {
      await voice
        .delete()
        .catch(() => null);
    }
  }

  db.prepare(`
    UPDATE applications
    SET
      status = 'completed',
      completed_at = ?,
      interview_voice_channel_id = NULL
    WHERE id = ?
  `).run(
    Date.now(),
    app.id
  );

  await postApplication(
    app.id
  );

  await postResults(
    app.id
  );

  if (app.mode === 'test') {
    markTestCheck(
      'end_interview'
    );
  }
}

// =====================================================
// RESET TEST DATA
// =====================================================

async function resetTestData(
  guild
) {
  const apps =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'test'
    `).all();

  for (const app of apps) {
    for (
      const channelId
      of [
        app.interview_text_channel_id,
        app.interview_voice_channel_id,
        app.scoring_channel_id,
      ]
    ) {
      if (!channelId) continue;

      const channel =
        await guild.channels
          .fetch(
            channelId
          )
          .catch(() => null);

      if (channel) {
        await channel
          .delete()
          .catch(() => null);
      }
    }

    db.prepare(`
      DELETE FROM approvals
      WHERE app_id = ?
    `).run(app.id);

    db.prepare(`
      DELETE FROM interviewers
      WHERE app_id = ?
    `).run(app.id);

    db.prepare(`
      DELETE FROM scores
      WHERE app_id = ?
    `).run(app.id);

    db.prepare(`
      DELETE FROM score_sessions
      WHERE app_id = ?
    `).run(app.id);

    db.prepare(`
      DELETE FROM reminders
      WHERE app_id = ?
    `).run(app.id);

    db.prepare(`
      DELETE FROM applications
      WHERE id = ?
    `).run(app.id);
  }

  const testChannelId =
    getSetting(
      'test_channel_id'
    );

  if (testChannelId) {
    const channel =
      await guild.channels
        .fetch(
          testChannelId
        )
        .catch(() => null);

    if (channel) {
      await channel
        .delete()
        .catch(() => null);
    }
  }

  setSetting(
    'test_channel_id',
    ''
  );

  setSetting(
    'system_mode',
    'closed'
  );

  resetTestChecks();

  markTestCheck(
    'test_cleanup'
  );
}

// =====================================================
// READY
// =====================================================

client.once(
  Events.ClientReady,
  async readyClient => {
    console.log(
      `✅ Logged in as ${readyClient.user.tag}`
    );

    try {
      const guild =
        await client.guilds
          .fetch(GUILD_ID);

      await ensureManagementPanel();

      const interrupted =
        db.prepare(`
          SELECT 1
          FROM applications
          WHERE mode = 'test'
            AND status = 'in_progress'
          LIMIT 1
        `).get();

      if (interrupted) {
        markTestCheck(
          'restart_persistence'
        );
      }

      await reminderCheck();

      setInterval(
        () => {
          reminderCheck()
            .catch(console.error);
        },
        60_000
      );
    } catch (error) {
      console.error(
        '❌ Startup error:',
        error
      );
    }
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    try {
      const guild =
        interaction.guild ||
        await client.guilds
          .fetch(GUILD_ID);

      const member =
        interaction.member ||
        await guild.members
          .fetch(
            interaction.user.id
          )
          .catch(() => null);

      // ===============================================
      // TEST MODE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'test_mode'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicChannel(
          guild
        );

        setSetting(
          'system_mode',
          'test'
        );

        resetTestChecks();

        await ensureManagementPanel();

        return safeReply(
          interaction,
          '🧪 Testing Mode is enabled. Next click **Choose Test Applicant**.'
        );
      }

      // ===============================================
      // CHOOSE TEST APPLICANT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'choose_test_applicant'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        if (
          getSetting(
            'system_mode'
          ) !== 'test'
        ) {
          return safeReply(
            interaction,
            'Enable Testing Mode first.'
          );
        }

        const select =
          new UserSelectMenuBuilder()
            .setCustomId(
              'test_applicant_select'
            )
            .setPlaceholder(
              'Choose test applicant'
            )
            .setMinValues(1)
            .setMaxValues(1);

        return interaction.reply({
          content:
            'Choose the test applicant:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                select
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId ===
          'test_applicant_select'
      ) {
        const userId =
          interaction.values[0];

        const channel =
          await createTestChannel(
            guild,
            userId
          );

        return interaction.update({
          content:
            `✅ Test applicant: <@${userId}>\n${channel}`,

          components: [],
        });
      }

      // ===============================================
      // CHECKLIST
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'test_checklist'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                '📋 Test Checklist'
              )
              .setDescription(
                checklistText()
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // OPEN PUBLIC
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'open_public'
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        return interaction.reply({
          content:
            '⚠️ **PUBLIC RELEASE**\nAre you sure you want to open real staff applications?',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    'confirm_public'
                  )
                  .setLabel(
                    'Yes — Go Public'
                  )
                  .setEmoji('🚀')
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'cancel_public'
                  )
                  .setLabel(
                    'Cancel'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'confirm_public'
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const channel =
          await createPublicChannel(
            guild
          );

        setSetting(
          'system_mode',
          'public'
        );

        await ensureManagementPanel();

        return interaction.update({
          content:
            `✅ Public staff applications are open: ${channel}`,

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'cancel_public'
      ) {
        return interaction.update({
          content:
            'Cancelled.',

          components: [],
        });
      }

      // ===============================================
      // CLOSE APPLICATIONS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'close_apps'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicChannel(
          guild
        );

        setSetting(
          'system_mode',
          'closed'
        );

        await ensureManagementPanel();

        return safeReply(
          interaction,
          '🔴 Applications closed.'
        );
      }

      // ===============================================
      // RESET TEST
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'reset_test'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        return interaction.reply({
          content:
            '⚠️ Delete all TEST data? Real applications will not be touched.',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    'confirm_reset'
                  )
                  .setLabel(
                    'Reset Test'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'cancel_reset'
                  )
                  .setLabel(
                    'Cancel'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'confirm_reset'
      ) {
        await interaction.deferUpdate();

        await resetTestData(
          guild
        );

        await ensureManagementPanel();

        return interaction.editReply({
          content:
            '✅ Test data reset.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'cancel_reset'
      ) {
        return interaction.update({
          content:
            'Cancelled.',

          components: [],
        });
      }

      // ===============================================
      // APPLY BUTTON
      // ===============================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
            'apply_test' ||
          interaction.customId ===
            'apply_real'
        )
      ) {
        const mode =
          interaction.customId ===
          'apply_test'
            ? 'test'
            : 'real';

        if (
          mode === 'test' &&
          getSetting(
            'system_mode'
          ) !== 'test'
        ) {
          return safeReply(
            interaction,
            'Testing Mode is disabled.'
          );
        }

        if (
          mode === 'real' &&
          getSetting(
            'system_mode'
          ) !== 'public'
        ) {
          return safeReply(
            interaction,
            'Applications are closed.'
          );
        }

        const existing =
          getActiveApplication(
            interaction.user.id,
            mode
          );

        if (existing) {
          return safeReply(
            interaction,
            `You already have an active application #${existing.id}.`
          );
        }

        return interaction.showModal(
          applicationModal(
            mode
          )
        );
      }

      // ===============================================
      // APPLICATION FORM SUBMIT
      // ===============================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'application_form:'
        )
      ) {
        const mode =
          interaction.customId
            .split(':')[1];

        const age =
          interaction.fields
            .getTextInputValue(
              'age'
            )
            .trim();

        const experience =
          interaction.fields
            .getTextInputValue(
              'experience'
            )
            .trim();

        const result =
          db.prepare(`
            INSERT INTO applications(
              user_id,
              mode,
              age,
              experience,
              interview_ts,
              timezone,
              status,
              created_at
            )
            VALUES(
              ?,
              ?,
              ?,
              ?,
              0,
              'PENDING',
              'choosing_time',
              ?
            )
          `).run(
            interaction.user.id,
            mode,
            age,
            experience,
            Date.now()
          );

        const app =
          getApplication(
            result.lastInsertRowid
          );

        if (mode === 'test') {
          markTestCheck(
            'application_form'
          );
        }

        return interaction.reply({
          ...buildDatePicker(
            app,
            0
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // DATE PAGE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'date_page:'
        )
      ) {
        const [
          ,
          appId,
          page,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        if (
          interaction.user.id !==
            app.user_id &&
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ You cannot edit this application.'
          );
        }

        return interaction.update(
          buildDatePicker(
            app,
            Number(page)
          )
        );
      }

      // ===============================================
      // DATE PICK
      // ===============================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_date:'
        )
      ) {
        const [
          ,
          appId,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const dateISO =
          interaction.values[0];

        return interaction.update(
          buildTimePicker(
            app,
            dateISO
          )
        );
      }

      // ===============================================
      // CHANGE DATE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_to_dates:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        return interaction.update(
          buildDatePicker(
            app,
            0
          )
        );
      }

      // ===============================================
      // TIME PICK
      // ===============================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_time:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        const timeValue =
          interaction.values[0];

        return interaction.update(
          buildTimezonePicker(
            app,
            dateISO,
            timeValue
          )
        );
      }

      // ===============================================
      // CHANGE TIME
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_to_times:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        return interaction.update(
          buildTimePicker(
            app,
            dateISO
          )
        );
      }

      // ===============================================
      // TIMEZONE PICK
      // ===============================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_timezone:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
          timeValue,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        return finishSchedule(
          interaction,
          app,
          dateISO,
          timeValue,
          interaction.values[0]
        );
      }

      // ===============================================
      // APPROVE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'approve:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const duplicate =
          db.prepare(`
            SELECT 1
            FROM approvals
            WHERE app_id = ?
              AND staff_id = ?
          `).get(
            app.id,
            interaction.user.id
          );

        if (duplicate) {
          return safeReply(
            interaction,
            'You already approved this interview.'
          );
        }

        db.prepare(`
          INSERT INTO approvals(
            app_id,
            staff_id,
            created_at
          )
          VALUES(?, ?, ?)
        `).run(
          app.id,
          interaction.user.id,
          Date.now()
        );

        db.prepare(`
          INSERT OR IGNORE INTO interviewers(
            app_id,
            staff_id
          )
          VALUES(?, ?)
        `).run(
          app.id,
          interaction.user.id
        );

        const approvals =
          getApprovals(
            app.id
          );

        let ownerApproval =
          false;

        for (
          const staffId
          of approvals
        ) {
          const staff =
            await guild.members
              .fetch(staffId)
              .catch(() => null);

          if (
            staff &&
            isOwnerOrCoOwner(
              staff
            )
          ) {
            ownerApproval =
              true;

            break;
          }
        }

        if (app.mode === 'test') {
          markTestCheck(
            'staff_approvals'
          );

          if (ownerApproval) {
            markTestCheck(
              'owner_override'
            );
          }
        }

        await postApplication(
          app.id
        );

        if (
          ownerApproval ||
          approvals.length >= 2
        ) {
          await confirmInterview(
            app.id,
            guild
          );

          return safeReply(
            interaction,
            '✅ Interview confirmed.'
          );
        }

        return safeReply(
          interaction,
          `✅ Approval recorded. ${approvals.length}/2 approvals.`
        );
      }

      // ===============================================
      // ASSIGN INTERVIEWERS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'assign:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          interaction.customId
            .split(':')[1];

        const select =
          new UserSelectMenuBuilder()
            .setCustomId(
              `assign_users:${appId}`
            )
            .setPlaceholder(
              'Choose interviewers'
            )
            .setMinValues(1)
            .setMaxValues(2);

        return interaction.reply({
          content:
            'Choose 1 or 2 interviewers:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                select
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId.startsWith(
          'assign_users:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const valid = [];

        for (
          const userId
          of interaction.values
        ) {
          const selectedMember =
            await guild.members
              .fetch(userId)
              .catch(() => null);

          if (
            selectedMember &&
            isAuthorizedStaff(
              selectedMember
            )
          ) {
            valid.push(
              userId
            );
          }
        }

        if (!valid.length) {
          return interaction.update({
            content:
              '❌ Selected users are not staff.',

            components: [],
          });
        }

        db.prepare(`
          DELETE FROM interviewers
          WHERE app_id = ?
        `).run(appId);

        for (
          const staffId
          of valid
        ) {
          db.prepare(`
            INSERT INTO interviewers(
              app_id,
              staff_id
            )
            VALUES(?, ?)
          `).run(
            appId,
            staffId
          );
        }

        await postApplication(
          appId
        );

        return interaction.update({
          content:
            `✅ Interviewers: ${valid.map(id => `<@${id}>`).join(', ')}`,

          components: [],
        });
      }

      // ===============================================
      // RESCHEDULE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reschedule:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        db.prepare(`
          UPDATE applications
          SET status = 'needs_time'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (user) {
          await user.send({
            content:
              '📅 Staff needs you to choose a different interview date/time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `choose_new_time:${app.id}`
                    )
                    .setLabel(
                      'Choose New Date & Time'
                    )
                    .setEmoji('📅')
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          }).catch(() => null);
        }

        if (app.mode === 'test') {
          markTestCheck(
            'rescheduling'
          );
        }

        return safeReply(
          interaction,
          '📅 Applicant asked to choose a new time.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'choose_new_time:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          interaction.user.id !==
          app.user_id
        ) {
          return safeReply(
            interaction,
            '❌ This button is only for the applicant.'
          );
        }

        return interaction.reply({
          ...buildDatePicker(
            app,
            0
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // CAN'T MAKE IT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'cant_make:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        db.prepare(`
          DELETE FROM interviewers
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          appId,
          interaction.user.id
        );

        db.prepare(`
          UPDATE applications
          SET status = 'needs_interviewer'
          WHERE id = ?
        `).run(
          appId
        );

        await postApplication(
          appId
        );

        return safeReply(
          interaction,
          '✅ You were removed from the interview.'
        );
      }

      // ===============================================
      // START TEST NOW
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'test_now:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        let app =
          getApplication(
            appId
          );

        if (
          !app ||
          app.mode !== 'test'
        ) {
          return safeReply(
            interaction,
            '❌ Test applications only.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET interview_ts = ?
          WHERE id = ?
        `).run(
          unixNow(),
          app.id
        );

        db.prepare(`
          INSERT OR IGNORE INTO interviewers(
            app_id,
            staff_id
          )
          VALUES(?, ?)
        `).run(
          app.id,
          interaction.user.id
        );

        app =
          getApplication(
            app.id
          );

        await confirmInterview(
          app.id,
          guild
        );

        await startInterview(
          app.id,
          guild,
          interaction.user.id
        );

        return safeReply(
          interaction,
          '⚡ Test interview started now. Check the interview voice channel and staff scoring channel.'
        );
      }

      // ===============================================
      // SIMULATE REMINDERS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reminder:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const [
          ,
          appId,
          reminder,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        const labels = {
          24:
            '24 Hours',

          1:
            '1 Hour',

          10:
            '10 Minutes',
        };

        await sendReminder(
          app,
          labels[reminder]
        );

        return safeReply(
          interaction,
          `🧪 ${labels[reminder]} reminder sent.`
        );
      }

      // ===============================================
      // START INTERVIEW
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'start_interview:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        try {
          await startInterview(
            appId,
            guild,
            interaction.user.id
          );

          return interaction.editReply(
            '🎙️ Interview started.'
          );
        } catch (error) {
          return interaction.editReply(
            `❌ ${error.message}`
          );
        }
      }

      // ===============================================
      // OPEN SCORECARD
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'scorecard:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          ) &&
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not an assigned interviewer.'
          );
        }

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          db.prepare(`
            INSERT OR IGNORE INTO interviewers(
              app_id,
              staff_id
            )
            VALUES(?, ?)
          `).run(
            app.id,
            interaction.user.id
          );
        }

        return interaction.reply({
          embeds: [
            scorecardEmbed(
              app,
              interaction.user.id
            ),
          ],

          components:
            scorecardComponents(
              app,
              interaction.user.id
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // SCORE QUESTION
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'score:'
        )
      ) {
        const [
          ,
          appId,
          index,
          score,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(appId)
          );

        const questions =
          getQuestions(app);

        const question =
          questions[
            Number(index)
          ];

        if (!question) {
          return safeReply(
            interaction,
            'Question not found.'
          );
        }

        db.prepare(`
          INSERT INTO scores(
            app_id,
            staff_id,
            question_key,
            score
          )
          VALUES(?, ?, ?, ?)
          ON CONFLICT(
            app_id,
            staff_id,
            question_key
          )
          DO UPDATE SET
            score = excluded.score
        `).run(
          app.id,
          interaction.user.id,
          question.key,
          Number(score)
        );

        db.prepare(`
          INSERT INTO score_sessions(
            app_id,
            staff_id,
            current_index,
            finished
          )
          VALUES(?, ?, ?, 0)
          ON CONFLICT(
            app_id,
            staff_id
          )
          DO UPDATE SET
            current_index =
              excluded.current_index
        `).run(
          app.id,
          interaction.user.id,
          Number(index)
        );

        if (app.mode === 'test') {
          markTestCheck(
            'scoring'
          );
        }

        return interaction.update({
          embeds: [
            scorecardEmbed(
              app,
              interaction.user.id
            ),
          ],

          components:
            scorecardComponents(
              app,
              interaction.user.id
            ),
        });
      }

      // ===============================================
      // PREVIOUS QUESTION
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'previous_question:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        const session =
          getScoreSession(
            app.id,
            interaction.user.id
          );

        const newIndex =
          Math.max(
            0,
            session.current_index -
              1
          );

        db.prepare(`
          UPDATE score_sessions
          SET current_index = ?
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          newIndex,
          app.id,
          interaction.user.id
        );

        if (app.mode === 'test') {
          markTestCheck(
            'navigation'
          );
        }

        return interaction.update({
          embeds: [
            scorecardEmbed(
              app,
              interaction.user.id
            ),
          ],

          components:
            scorecardComponents(
              app,
              interaction.user.id
            ),
        });
      }

      // ===============================================
      // NEXT QUESTION
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'next_question:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        const session =
          getScoreSession(
            app.id,
            interaction.user.id
          );

        const questions =
          getQuestions(app);

        const newIndex =
          Math.min(
            questions.length - 1,
            session.current_index +
              1
          );

        db.prepare(`
          UPDATE score_sessions
          SET current_index = ?
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          newIndex,
          app.id,
          interaction.user.id
        );

        if (app.mode === 'test') {
          markTestCheck(
            'navigation'
          );
        }

        return interaction.update({
          embeds: [
            scorecardEmbed(
              app,
              interaction.user.id
            ),
          ],

          components:
            scorecardComponents(
              app,
              interaction.user.id
            ),
        });
      }

      // ===============================================
      // FINISH SCORE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'finish_score:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        const total =
          interviewerTotal(
            app.id,
            interaction.user.id
          );

        if (
          total.count < 21
        ) {
          return safeReply(
            interaction,
            `❌ You scored ${total.count}/21 questions. Finish every question first.`
          );
        }

        db.prepare(`
          INSERT INTO score_sessions(
            app_id,
            staff_id,
            current_index,
            finished
          )
          VALUES(?, ?, 20, 1)
          ON CONFLICT(
            app_id,
            staff_id
          )
          DO UPDATE SET
            finished = 1
        `).run(
          app.id,
          interaction.user.id
        );

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          app.mode === 'test' &&
          interviewers.length >= 2
        ) {
          const finished =
            interviewers.filter(
              staffId =>
                db.prepare(`
                  SELECT finished
                  FROM score_sessions
                  WHERE app_id = ?
                    AND staff_id = ?
                `).get(
                  app.id,
                  staffId
                )?.finished === 1
            );

          if (
            finished.length >= 2
          ) {
            markTestCheck(
              'two_interviewer_scoring'
            );
          }
        }

        return interaction.update({
          content:
            `✅ Scorecard complete: **${total.total}/63** — ${((total.total / 63) * 100).toFixed(1)}%`,

          embeds: [],

          components: [],
        });
      }

      // ===============================================
      // END INTERVIEW
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'end_interview:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          interaction.customId
            .split(':')[1];

        return interaction.reply({
          content:
            '🏁 Are you sure you want to end the interview?',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_end:${appId}`
                  )
                  .setLabel(
                    'Yes — End Interview'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'cancel_end'
                  )
                  .setLabel(
                    'Cancel'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_end:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        await interaction.deferUpdate();

        try {
          await finishInterview(
            appId,
            guild
          );

          return interaction.editReply({
            content:
              '✅ Interview ended and results posted.',

            components: [],
          });
        } catch (error) {
          return interaction.editReply({
            content:
              `❌ ${error.message}`,

            components: [],
          });
        }
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'cancel_end'
      ) {
        return interaction.update({
          content:
            'Interview continues.',

          components: [],
        });
      }

      // ===============================================
      // ACCEPT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'accept:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        db.prepare(`
          UPDATE applications
          SET status = 'accepted'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        if (app.mode === 'test') {
          markTestCheck(
            'final_decision'
          );
        }

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (user) {
          await user.send(
            app.mode === 'test'
              ? '🧪 TEST: Application marked accepted. No real staff role was given.'
              : '✅ Your Crafted SMP staff application was accepted!'
          ).catch(() => null);
        }

        return safeReply(
          interaction,
          app.mode === 'test'
            ? '🧪 Test applicant marked accepted.'
            : '✅ Applicant accepted.'
        );
      }

      // ===============================================
      // REJECT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reject:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        db.prepare(`
          UPDATE applications
          SET status = 'rejected'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        if (app.mode === 'test') {
          markTestCheck(
            'final_decision'
          );
        }

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (user) {
          await user.send(
            app.mode === 'test'
              ? '🧪 TEST: Application marked rejected.'
              : '❌ Your Crafted SMP staff application was not accepted at this time.'
          ).catch(() => null);
        }

        return safeReply(
          interaction,
          'Application marked rejected.'
        );
      }

      // ===============================================
      // FURTHER REVIEW
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'review:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        db.prepare(`
          UPDATE applications
          SET status = 'further_review'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        if (app.mode === 'test') {
          markTestCheck(
            'final_decision'
          );
        }

        return safeReply(
          interaction,
          '🟡 Application moved to further review.'
        );
      }
    } catch (error) {
      console.error(
        'Interaction error:',
        error
      );

      await safeReply(
        interaction,
        `❌ Something went wrong: ${error.message}`
      );
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

client.login(
  DISCORD_TOKEN
);
