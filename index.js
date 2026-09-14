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

const GUILD_ID = '1543363950262100118';

const APPLICATION_CONTROL_CHANNEL_ID = '1548840885167587399';
const SUBMITTED_APPLICATIONS_CHANNEL_ID = '1548841190609129522';
const INTERVIEW_NOTIFICATION_CHANNEL_ID = '1548846551890137189';
const INTERVIEW_RESULTS_CHANNEL_ID = '1548849111179067472';

const MAIN_CATEGORY_ID = '1543364258308300840';
const SCORING_CATEGORY_ID = '1548862844186001478';

const OWNER_ROLE_ID = '1546564866045902978';
const CO_OWNER_ROLE_ID = '1548519417992974356';
const SENIOR_STAFF_ROLE_ID = '1543367669385011302';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

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
  mode TEXT NOT NULL DEFAULT 'real',
  age TEXT NOT NULL,
  experience TEXT NOT NULL,
  interview_ts INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'PENDING',
  status TEXT NOT NULL DEFAULT 'choosing_time',
  submission_message_id TEXT,
  interview_text_channel_id TEXT,
  interview_voice_channel_id TEXT,
  scoring_channel_id TEXT,
  notification_message_id TEXT,
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
  added_by TEXT,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS interviewer_category_progress (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  category_index INTEGER NOT NULL,
  selected_questions TEXT NOT NULL DEFAULT '[]',
  current_pick_index INTEGER NOT NULL DEFAULT 0,
  category_notes TEXT NOT NULL DEFAULT '',
  finished INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id, staff_id, category_index)
);

CREATE TABLE IF NOT EXISTS question_scores (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  category_index INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  point INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(app_id, staff_id, category_index, question_number)
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  current_category INTEGER NOT NULL DEFAULT -1,
  finished INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id, staff_id)
);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('applications', 'submission_message_id', 'TEXT');
ensureColumn('applications', 'interview_text_channel_id', 'TEXT');
ensureColumn('applications', 'interview_voice_channel_id', 'TEXT');
ensureColumn('applications', 'scoring_channel_id', 'TEXT');
ensureColumn('applications', 'notification_message_id', 'TEXT');
ensureColumn('applications', 'completed_at', 'INTEGER');
ensureColumn('interviewers', 'added_by', 'TEXT');

const OPENING_BRIEF = [
  '**Welcome to the Moderator Application Process!**',
  '',
  'Thank you for your interest in helping make our SMP a fun, fair, and welcoming community. Moderators are expected to be mature, active, respectful, and capable of handling situations professionally.',
  '',
  'Please answer all questions honestly and in detail.',
  '',
  'You have about **1 minute to answer each question**.',
  '',
  'Questions not answered, or with a 5–10 second delay, may be skipped and can impact your score.',
  '',
  '**This meeting is recorded and reviewed.**',
  '',
  'You will be graded based on your performance during the meeting.',
  '',
  '🛡️ **Trial Moderator Promotion Board**',
].join('\n');

const CLOSING_BRIEF = [
  '**🏁 Interview Closing Brief**',
  '',
  'Thank you for completing the Crafted SMP Moderator interview.',
  '',
  'Staff will now finish reviewing your interview performance.',
  '',
  'Your responses, professionalism, judgment, and overall performance will be considered.',
  '',
  'Please do not ask interviewers for your score or result during or immediately after the interview.',
  '',
  'Staff will handle the final decision privately.',
  '',
  'Thank you for taking the time to participate in the **Trial Moderator Promotion Board**.',
].join('\n');

const QUESTION_CATEGORIES = [
  {
    name: '📖 General Knowledge',
    code: 'DE',
    questions: [
      { number: 1, text: 'Why do you want to become a Moderator?' },
      { number: 2, text: 'What do you believe the role of a moderator is?' },
      { number: 3, text: 'What qualities make an excellent moderator?' },
      { number: 4, text: 'What does fairness mean to you?' },
      { number: 5, text: 'Why is professionalism important when moderating a community?' },
    ],
  },

  {
    name: '🤝 Community & Leadership',
    code: '',
    questions: [
      { number: 6, text: 'How would you help new players feel welcomed on the SMP?' },
      { number: 7, text: 'What would you do to improve the community experience?' },
      { number: 8, text: 'How do you handle disagreements with other people?' },
      { number: 9, text: 'What makes a good leader?' },
      { number: 10, text: 'Why should the staff team trust you with moderation permissions?' },
    ],
  },

  {
    name: '⚖️ Rule Enforcement Scenarios',
    code: 'KI',
    questions: [
      { number: 12, text: 'You witness a player using inappropriate language in global chat. What actions would you take?' },
      { number: 13, text: 'A player is intentionally trying to provoke others into breaking rules. How would you deal with this?' },
      { number: 14, text: 'A player is bypassing chat filters and is repeatedly spamming chat after multiple warnings. How would you handle the situation? send inappropriate messages. What would you do?' },
      { number: 15, text: 'Several players report someone for hacking, but there is no evidence. What steps would you take before making a decision?' },
    ],
  },

  {
    name: '🔥 Advanced Scenario Questions',
    code: 'DE',
    questions: [
      { number: 16, text: 'One of your close friends is caught cheating. They ask you not to report them. What would you do and why?' },
      { number: 17, text: 'A popular player is breaking rules, but many community members defend them because they are well-known. How would you handle the situation?' },
      { number: 18, text: 'You accidentally punish the wrong player. What would you do next?' },
      { number: 19, text: 'Another moderator gives a punishment that you believe is unfair. How would you address the situation?' },
      { number: 20, text: 'You are the only staff member online and multiple issues happen at the same time:\n• A player is spamming.\n• Someone reports a hacker.\n• Two players are arguing in chat.\nHow would you prioritize and handle each situation?' },
    ],
  },

  {
    name: '🧠 Judgment & Decision Making',
    code: '',
    questions: [
      { number: 21, text: 'What would you do if you were unsure how to handle a moderation situation?' },
      { number: 22, text: 'When should a moderator ask for help from higher-ranking staff?' },
      { number: 23, text: 'What is more important:\n• Being liked by players\n• Enforcing rules fairly\nExplain your answer.' },
      { number: 24, text: 'How would you respond to a player who becomes angry after receiving a punishment?' },
      { number: 25, text: 'What would you do if someone accused you of staff abuse?' },
    ],
  },

  {
    name: '🚨 Serious Staff Scenarios',
    code: '',
    questions: [
      { number: 26, text: 'You discover another staff member abusing their permissions. What actions would you take?' },
      { number: 27, text: 'A player privately tells you they found a duplication exploit that could harm the economy. What would you do?' },
      { number: 28, text: 'A player threatens to leave the server unless their punishment is removed. How would you respond?' },
      { number: 29, text: 'You find evidence that a staff member is leaking private staff information. What would you do?' },
      { number: 30, text: 'A player creates multiple alternate accounts to evade punishments. How would you investigate and handle the situation?' },
    ],
  },

  {
    name: '🎭 Bonus Question (Troll Check)',
    code: 'DE',
    questions: [
      {
        number: 34,
        text: 'You are given Owner rank for 5 minutes. What is the very first thing you do?\n\n(This question is designed to test maturity, judgment, and whether applicants think about helping the server rather than abusing power.)',
      },
      {
        number: 35,
        text: 'As A moderator you contain role of leadership and persuasion right now persuasive to us with out breaking character why ketchup should be a soup',
      },
      {
        number: 36,
        text: 'As being persuasive explain why should noodles be on a pizza',
      },
      {
        number: 37,
        text: 'Ask them to explain how coffee can be a type of tea',
      },
    ],
  },
];

const CATEGORY_COUNT = QUESTION_CATEGORIES.length;
const QUESTIONS_PER_CATEGORY = 3;
const MAX_SCORE_PER_INTERVIEWER = CATEGORY_COUNT * QUESTIONS_PER_CATEGORY;

// =====================================================
// WEEK / DATE / TIME PICKER
// =====================================================

const MAX_WEEKS = 12;

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
    description: 'Hawaii Standard Time',
  },

  {
    label: 'Pacific',
    value: 'PACIFIC',
    description: 'PST / PDT',
  },

  {
    label: 'Mountain',
    value: 'MOUNTAIN',
    description: 'MST / MDT',
  },

  {
    label: 'Central',
    value: 'CENTRAL',
    description: 'CST / CDT',
  },

  {
    label: 'Eastern',
    value: 'EASTERN',
    description: 'EST / EDT',
  },
];

const TIMEZONE_ZONES = {
  HST: 'Pacific/Honolulu',
  PACIFIC: 'America/Los_Angeles',
  MOUNTAIN: 'America/Denver',
  CENTRAL: 'America/Chicago',
  EASTERN: 'America/New_York',
};

function minimumSelectableDate(app) {
  const today =
    DateTime.now()
      .setZone('Pacific/Honolulu')
      .startOf('day');

  return app.mode === 'real'
    ? today.plus({ days: 7 })
    : today;
}

function weekStartFor(app, weekIndex) {
  return minimumSelectableDate(app)
    .plus({
      days: weekIndex * 7,
    });
}

function buildWeekPicker(app) {
  const options = [];

  for (
    let weekIndex = 0;
    weekIndex < MAX_WEEKS;
    weekIndex++
  ) {
    const start =
      weekStartFor(
        app,
        weekIndex
      );

    const end =
      start.plus({
        days: 6,
      });

    options.push({
      label:
        `Week ${weekIndex + 1}`,

      description:
        `${start.toFormat('LLL d')} - ${end.toFormat('LLL d, yyyy')}`,

      value:
        String(weekIndex),
    });
  }

  const select =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_week:${app.id}`
      )
      .setPlaceholder(
        'Choose which week'
      )
      .addOptions(
        options
      );

  return {
    content: [
      '🗓️ **Choose Which Week**',
      '',

      app.mode === 'real'
        ? 'Week 1 starts at least **7 days from today**.'
        : '🧪 Test Mode: Week 1 starts **today**.',

      '',
      'After choosing a week, you will choose the exact day.',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),
    ],
  };
}

function buildDatePicker(
  app,
  weekIndex = 0
) {
  weekIndex =
    Math.max(
      0,
      Math.min(
        MAX_WEEKS - 1,
        Number(weekIndex) || 0
      )
    );

  const start =
    weekStartFor(
      app,
      weekIndex
    );

  const options = [];

  for (
    let i = 0;
    i < 7;
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
        `pick_date:${app.id}:${weekIndex}`
      )
      .setPlaceholder(
        `Choose a day from Week ${weekIndex + 1}`
      )
      .addOptions(
        options
      );

  return {
    content: [
      `📅 **Week ${weekIndex + 1}: Choose Interview Day**`,
      '',

      `${start.toFormat('cccc, LLLL d')} - ${start.plus({
        days: 6,
      }).toFormat(
        'cccc, LLLL d, yyyy'
      )}`,
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
              `back_weeks:${app.id}`
            )
            .setLabel(
              'Change Week'
            )
            .setEmoji(
              '⬅️'
            )
            .setStyle(
              ButtonStyle.Secondary
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
        'Scroll and choose a time'
      )
      .addOptions(
        TIME_OPTIONS.map(
          (
            [
              value,
              label,
            ]
          ) => ({
            value,
            label,
          })
        )
      );

  return {
    content:
      `📅 **${DateTime.fromISO(
        dateISO
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**\n\n🕐 **Choose Interview Time**`,

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `back_weeks:${app.id}`
            )
            .setLabel(
              'Change Week / Day'
            )
            .setEmoji(
              '⬅️'
            )
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
    content:
      `📅 **${DateTime.fromISO(
        dateISO
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**\n🕐 **${friendly}**\n\n🌎 **Choose Your Time Zone**`,

    components: [
      new ActionRowBuilder()
        .addComponents(
          select
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `back_times:${app.id}:${dateISO}`
            )
            .setLabel(
              'Change Time'
            )
            .setEmoji(
              '⬅️'
            )
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

  return dt.isValid
    ? Math.floor(
        dt.toSeconds()
      )
    : null;
}

// =====================================================
// GENERAL HELPERS
// =====================================================

function unixNow() {
  return Math.floor(
    Date.now() /
    1000
  );
}

function slugify(name) {
  return (
    name ||
    'applicant'
  )
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
    'applicant';
}

function getSetting(
  key,
  fallback = null
) {
  const row =
    db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    )
      .get(
        key
      );

  return row
    ? row.value
    : fallback;
}

function setSetting(
  key,
  value
) {
  db.prepare(`
    INSERT INTO settings(
      key,
      value
    )
    VALUES(
      ?,
      ?
    )

    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value
  `).run(
    key,
    String(value)
  );
}

if (
  !getSetting(
    'system_mode'
  )
) {
  setSetting(
    'system_mode',
    'closed'
  );
}

function statusLabel(status) {
  const map = {
    choosing_time:
      '📅 Choosing Interview Time',

    pending:
      '🟡 Pending Review',

    needs_time:
      '🟠 Needs Different Time',

    confirmed:
      '🟢 Interview Confirmed',

    in_progress:
      '🔵 Interview In Progress',

    completed:
      '✅ Interview Completed',

    accepted:
      '✅ Accepted',

    rejected:
      '🔴 Rejected',

    cancelled:
      '⚫ Cancelled',

    further_review:
      '🟡 Further Review',
  };

  return map[status] ||
    status;
}

function hasRole(
  member,
  roleId
) {
  return Boolean(
    member?.roles?.cache?.has(
      roleId
    )
  );
}

function isOwner(member) {
  return hasRole(
    member,
    OWNER_ROLE_ID
  );
}

function isCoOwner(member) {
  return hasRole(
    member,
    CO_OWNER_ROLE_ID
  );
}

function isSenior(member) {
  return hasRole(
    member,
    SENIOR_STAFF_ROLE_ID
  );
}

function isOwnerOrCoOwner(member) {
  return (
    isOwner(member) ||
    isCoOwner(member)
  );
}

function isAuthorizedStaff(member) {
  return (
    isOwner(member) ||
    isCoOwner(member) ||
    isSenior(member)
  );
}

async function safeEphemeral(
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
      .catch(
        () =>
          null
      );
  }

  return interaction
    .reply({
      content,
      flags:
        MessageFlags.Ephemeral,
    })
    .catch(
      () =>
        null
    );
}

async function fetchTextChannel(id) {
  if (!id) {
    return null;
  }

  const channel =
    await client.channels
      .fetch(
        id
      )
      .catch(
        () =>
          null
      );

  return channel?.isTextBased()
    ? channel
    : null;
}

function getApplication(appId) {
  return db.prepare(
    'SELECT * FROM applications WHERE id = ?'
  ).get(
    appId
  );
}

function getActiveApplicationForUser(
  userId,
  mode
) {
  return db.prepare(`
    SELECT *
    FROM applications
    WHERE user_id = ?
      AND mode = ?
      AND status NOT IN (
        'rejected',
        'cancelled',
        'completed',
        'accepted'
      )
    ORDER BY id DESC
    LIMIT 1
  `).get(
    userId,
    mode
  );
}

function getApprovals(appId) {
  return db.prepare(`
    SELECT staff_id
    FROM approvals
    WHERE app_id = ?
    ORDER BY created_at
  `)
    .all(
      appId
    )
    .map(
      row =>
        row.staff_id
    );
}

function getInterviewers(appId) {
  return db.prepare(`
    SELECT staff_id
    FROM interviewers
    WHERE app_id = ?
  `)
    .all(
      appId
    )
    .map(
      row =>
        row.staff_id
    );
}

function ensureApplicantOwnsPicker(
  interaction,
  app
) {
  return (
    app &&
    app.user_id ===
      interaction.user.id
  );
}

function staffTextPermissions(
  guild,
  applicantId = null
) {
  const overwrites = [
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

  if (
    applicantId
  ) {
    overwrites.push({
      id:
        applicantId,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return overwrites;
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

  const state =
    mode === 'test'
      ? '🧪 Testing Mode'
      : mode === 'public'
        ? '🟢 Public Applications Open'
        : '🔴 Applications Closed';

  return new EmbedBuilder()
    .setTitle(
      '🛡️ Crafted SMP Staff Application System'
    )
    .setDescription([
      `**Current Status:** ${state}`,
      '',

      'This channel is only for application management.',
      '',

      `📊 Permanent scores: <#${INTERVIEW_RESULTS_CHANNEL_ID}>`,
      '',

      '**Important:** Start Interview and End Interview only exist inside the private scoring channel.',

      `They never appear in <#${SUBMITTED_APPLICATIONS_CHANNEL_ID}>.`,
    ].join('\n'));
}

function managementRows() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'manage_test_mode'
          )
          .setLabel(
            'Testing Mode'
          )
          .setEmoji(
            '🧪'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_test_applicant'
          )
          .setLabel(
            'Choose Test Applicant'
          )
          .setEmoji(
            '👤'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'manage_public_open'
          )
          .setLabel(
            'Enable Public Applications'
          )
          .setEmoji(
            '🚀'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_close'
          )
          .setLabel(
            'Close Applications'
          )
          .setEmoji(
            '🔴'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_reset_test'
          )
          .setLabel(
            'Reset Test'
          )
          .setEmoji(
            '🗑️'
          )
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

async function ensureManagementPanel() {
  const channel =
    await fetchTextChannel(
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
        limit:
          50,
      })
      .catch(
        () =>
          null
      );

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
                  'manage_test_mode'
            )
        )
    );

  if (
    existing
  ) {
    await existing.edit({
      embeds: [
        managementEmbed(),
      ],

      components:
        managementRows(),
    })
      .catch(
        () =>
          null
      );

    return existing;
  }

  return channel.send({
    embeds: [
      managementEmbed(),
    ],

    components:
      managementRows(),
  });
}

async function refreshManagementPanel() {
  await ensureManagementPanel()
    .catch(
      console.error
    );
}

// =====================================================
// APPLICATION PANEL
// =====================================================

function applicationPanelEmbed(
  isTest = false
) {
  return new EmbedBuilder()
    .setTitle(
      isTest
        ? '🧪 Crafted SMP Staff Application — TEST MODE'
        : '🛡️ Crafted SMP Staff Applications'
    )
    .setDescription([
      isTest
        ? '**This is only a test application.**'
        : '**Applications are currently open.**',

      '',

      '1. Enter your age and moderation experience.',

      '2. Choose which week works for you.',

      '3. Choose the exact day in that week.',

      '4. Choose your interview time.',

      '5. Choose your time zone.',

      '',

      isTest
        ? '⚡ Test interviews can use today.'
        : '📅 Real interviews must be at least 7 days in advance.',
    ].join('\n'));
}

function applicationButton(
  isTest = false
) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          isTest
            ? 'apply_test'
            : 'apply_public'
        )
        .setLabel(
          isTest
            ? 'Submit Test Application'
            : 'Apply for Staff'
        )
        .setEmoji(
          isTest
            ? '🧪'
            : '🛡️'
        )
        .setStyle(
          ButtonStyle.Primary
        )
    );
}

function buildApplicationModal(mode) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `application_modal:${mode}`
      )
      .setTitle(
        mode === 'test'
          ? 'TEST Staff Application'
          : 'Staff Application'
      );

  const age =
    new TextInputBuilder()
      .setCustomId(
        'age'
      )
      .setLabel(
        'What is your age?'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(
        true
      )
      .setMaxLength(
        20
      );

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
      .setRequired(
        true
      )
      .setMaxLength(
        1000
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        age
      ),

    new ActionRowBuilder()
      .addComponents(
        experience
      )
  );

  return modal;
}

async function createPublicApplicationChannel(
  guild
) {
  const oldId =
    getSetting(
      'public_application_channel_id'
    );

  if (
    oldId
  ) {
    const existing =
      await guild.channels
        .fetch(
          oldId
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
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

      reason:
        'Crafted SMP public staff applications opened',
    });

  await channel.send({
    embeds: [
      applicationPanelEmbed(
        false
      ),
    ],

    components: [
      applicationButton(
        false
      ),
    ],
  });

  setSetting(
    'public_application_channel_id',
    channel.id
  );

  return channel;
}

async function deletePublicApplicationChannel(
  guild
) {
  const channelId =
    getSetting(
      'public_application_channel_id'
    );

  if (
    !channelId
  ) {
    return;
  }

  const channel =
    await guild.channels
      .fetch(
        channelId
      )
      .catch(
        () =>
          null
      );

  if (
    channel
  ) {
    await channel
      .delete(
        'Staff applications closed'
      )
      .catch(
        () =>
          null
      );
  }

  setSetting(
    'public_application_channel_id',
    ''
  );
}

async function createTestApplicantChannel(
  guild,
  userId
) {
  const member =
    await guild.members
      .fetch(
        userId
      )
      .catch(
        () =>
          null
      );

  if (
    !member
  ) {
    throw new Error(
      'Test applicant is not in this server.'
    );
  }

  const oldId =
    getSetting(
      'test_application_channel_id'
    );

  if (
    oldId
  ) {
    const old =
      await guild.channels
        .fetch(
          oldId
        )
        .catch(
          () =>
            null
        );

    if (
      old
    ) {
      await old
        .delete(
          'Replacing test application channel'
        )
        .catch(
          () =>
            null
        );
    }
  }

  const channel =
    await guild.channels.create({
      name:
        `test-application-${slugify(
          member.user.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        staffTextPermissions(
          guild,
          userId
        ),

      reason:
        'Crafted SMP staff application testing mode',
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
      applicationButton(
        true
      ),
    ],
  });

  setSetting(
    'test_application_channel_id',
    channel.id
  );

  return channel;
}

// =====================================================
// SUBMITTED APPLICATIONS
//
// START INTERVIEW IS NOT HERE.
// END INTERVIEW IS NOT HERE.
// =====================================================

async function postSubmittedApplication(
  appId
) {
  const app =
    getApplication(
      appId
    );

  if (!app) {
    return;
  }

  const channel =
    await fetchTextChannel(
      SUBMITTED_APPLICATIONS_CHANNEL_ID
    );

  if (!channel) {
    throw new Error(
      'Submitted applications channel not found.'
    );
  }

  const approvals =
    getApprovals(
      appId
    );

  const interviewers =
    getInterviewers(
      appId
    );

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
            'Interview Time',

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

          inline:
            false,
        },

        {
          name:
            'Confirmations',

          value:
            approvals.length
              ? approvals
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(
                    '\n'
                  )
              : 'None yet',

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
                  .join(
                    '\n'
                  )
              : 'None yet',

          inline:
            true,
        }
      )
      .setFooter({
        text:
          `Application #${app.id}`,
      });

  if (
    app.mode === 'test'
  ) {
    embed.setDescription(
      '🧪 **TEST DATA — NOT A REAL APPLICATION**'
    );
  }

  const rows = [];

  if (
    ![
      'completed',
      'accepted',
      'rejected',
      'cancelled',
    ].includes(
      app.status
    )
  ) {
    rows.push(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `approve:${app.id}`
            )
            .setLabel(
              'Confirm Interview'
            )
            .setEmoji(
              '✅'
            )
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `reschedule_request:${app.id}`
            )
            .setLabel(
              'Choose Different Time'
            )
            .setEmoji(
              '📅'
            )
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
            .setEmoji(
              '❌'
            )
            .setStyle(
              ButtonStyle.Secondary
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
        .catch(
          () =>
            null
        );
  }

  if (
    message
  ) {
    await message.edit({
      embeds: [
        embed,
      ],

      components:
        rows,
    });
  } else {
    message =
      await channel.send({
        embeds: [
          embed,
        ],

        components:
          rows,
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
// SAVE SCHEDULE
// =====================================================

async function saveSchedule(
  interaction,
  app,
  dateISO,
  timeValue,
  timezoneValue
) {
  const timestamp =
    selectedDateTimeToUnix(
      dateISO,
      timeValue,
      timezoneValue
    );

  if (
    !timestamp
  ) {
    return safeEphemeral(
      interaction,
      '❌ Could not create that date/time.'
    );
  }

  if (
    app.mode === 'real' &&
    timestamp <
      unixNow() +
      7 *
      24 *
      60 *
      60
  ) {
    return safeEphemeral(
      interaction,
      '❌ Real interviews must be at least 7 days in advance.'
    );
  }

  db.prepare(`
    UPDATE applications
    SET
      interview_ts = ?,
      timezone = ?,
      status = 'pending'
    WHERE id = ?
  `).run(
    timestamp,
    timezoneValue,
    app.id
  );

  db.prepare(`
    DELETE FROM approvals
    WHERE app_id = ?
  `).run(
    app.id
  );

  db.prepare(`
    DELETE FROM interviewers
    WHERE app_id = ?
  `).run(
    app.id
  );

  await postSubmittedApplication(
    app.id
  );

  return interaction.update({
    content: [
      '✅ **Interview time selected!**',
      '',
      `<t:${timestamp}:F>`,
      `<t:${timestamp}:R>`,
      '',
      'Discord automatically converts this to each person’s local time.',
    ].join('\n'),

    components: [],
  });
}

// =====================================================
// APPROVAL RULE
// =====================================================

async function getApprovalStatus(
  appId,
  guild
) {
  const approvals =
    getApprovals(
      appId
    );

  let seniorCount = 0;
  let ownerOverride = false;

  for (
    const id
    of approvals
  ) {
    const member =
      await guild.members
        .fetch(
          id
        )
        .catch(
          () =>
            null
        );

    if (
      !member
    ) {
      continue;
    }

    if (
      isOwnerOrCoOwner(
        member
      )
    ) {
      ownerOverride =
        true;
    } else if (
      isSenior(
        member
      )
    ) {
      seniorCount++;
    }
  }

  return {
    approvals,
    seniorCount,
    ownerOverride,

    confirmed:
      ownerOverride ||
      seniorCount >= 2,
  };
}

// =====================================================
// INTERVIEW CHANNELS
// =====================================================

async function ensureInterviewTextChannel(
  app,
  guild
) {
  if (
    app.interview_text_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.interview_text_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const member =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const channel =
    await guild.channels.create({
      name:
        `interview-${slugify(
          member?.user?.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        staffTextPermissions(
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

  return channel;
}

async function ensureScoringChannel(
  app,
  guild
) {
  if (
    app.scoring_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.scoring_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const member =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const channel =
    await guild.channels.create({
      name:
        `scoring-${slugify(
          member?.user?.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        SCORING_CATEGORY_ID,

      permissionOverwrites:
        staffTextPermissions(
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

  return channel;
}

// =====================================================
// SCORING HOME
//
// START + END ONLY EXIST HERE
// =====================================================

function scoringControlRows(
  appId
) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `owner_start:${appId}`
          )
          .setLabel(
            'Start Interview'
          )
          .setEmoji(
            '🎙️'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `owner_end:${appId}`
          )
          .setLabel(
            'End Interview'
          )
          .setEmoji(
            '🏁'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `add_senior_staff:${appId}`
          )
          .setLabel(
            'Add Senior Staff'
          )
          .setEmoji(
            '➕'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `open_interview_board:${appId}`
          )
          .setLabel(
            'Open Interview Board'
          )
          .setEmoji(
            '📝'
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `view_score_progress:${appId}`
          )
          .setLabel(
            'View My Scores'
          )
          .setEmoji(
            '📊'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `cant_make:${appId}`
          )
          .setLabel(
            'Cancel Interviewing'
          )
          .setEmoji(
            '❌'
          )
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

async function postScoringHome(
  app,
  guild
) {
  const channel =
    await ensureScoringChannel(
      app,
      guild
    );

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '🛡️ Trial Moderator Promotion Board'
        )
        .setDescription([
          OPENING_BRIEF,
          '',

          '### Scoring Rules',

          '• Each category shows all available questions.',

          '• Pick exactly **3 questions** from the category.',

          '• Each selected question is worth **1 point**.',

          '• Each question is graded **0/1** or **1/1**.',

          '• Every selected question has its own notes.',

          '• Every category can also have overall category notes.',

          '• Each category is worth **3 points maximum**.',

          `• Maximum score per interviewer is **${MAX_SCORE_PER_INTERVIEWER} points**.`,

          '',

          '**Each interviewer scores independently.**',

          '',

          '**The applicant cannot see this channel.**',
        ].join('\n')),
    ],

    components:
      scoringControlRows(
        app.id
      ),
  });

  return channel;
}

// =====================================================
// CONFIRM INTERVIEW
// =====================================================

async function confirmInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    return;
  }

  const textChannel =
    await ensureInterviewTextChannel(
      app,
      guild
    );

  app =
    getApplication(
      app.id
    );

  await postScoringHome(
    app,
    guild
  );

  db.prepare(`
    UPDATE applications
    SET status = 'confirmed'
    WHERE id = ?
  `).run(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  await textChannel.send({
    content:
      `<@${app.user_id}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          '✅ Staff Interview Confirmed'
        )
        .setDescription([
          `**Interview:** <t:${app.interview_ts}:F>`,
          `**Starts:** <t:${app.interview_ts}:R>`,
          '',

          'Wait for the Owner or Co-Owner to start the interview.',

          'The voice channel will appear here once the interview starts.',
        ].join('\n')),
    ],
  });

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    await notificationChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '✅ Interview Confirmed'
          )
          .setDescription([
            `Applicant: <@${app.user_id}>`,
            `Interview: <t:${app.interview_ts}:F>`,
          ].join('\n')),
      ],
    });
  }

  await postSubmittedApplication(
    app.id
  );
}

// =====================================================
// VOICE CHANNEL
// =====================================================

async function createVoiceChannel(
  app,
  guild
) {
  if (
    app.interview_voice_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.interview_voice_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const applicant =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const interviewers =
    getInterviewers(
      app.id
    );

  const overwrites = [
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
  ];

  for (
    const staffId
    of interviewers
  ) {
    overwrites.push({
      id:
        staffId,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });
  }

  const voice =
    await guild.channels.create({
      name:
        `Interview - ${applicant?.user?.username || 'Applicant'}`,

      type:
        ChannelType.GuildVoice,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        overwrites,
    });

  db.prepare(`
    UPDATE applications
    SET interview_voice_channel_id = ?
    WHERE id = ?
  `).run(
    voice.id,
    app.id
  );

  return voice;
}

async function startInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    throw new Error(
      'Application not found.'
    );
  }

  const approval =
    await getApprovalStatus(
      app.id,
      guild
    );

  if (
    !approval.confirmed
  ) {
    throw new Error(
      'This needs 2 Senior Staff confirmations or 1 Owner/Co-Owner confirmation.'
    );
  }

  const voice =
    await createVoiceChannel(
      app,
      guild
    );

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

  const applicantChannel =
    await fetchTextChannel(
      app.interview_text_channel_id
    );

  if (
    applicantChannel
  ) {
    await applicantChannel.send({
      content:
        `<@${app.user_id}>`,

      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Your Interview Has Started'
          )
          .setDescription([
            'Staff is ready.',
            '',
            `### 🔊 Join here: ${voice}`,
          ].join('\n')),
      ],
    });
  }

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    await notificationChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Interview Started'
          )
          .setDescription([
            `Applicant: <@${app.user_id}>`,
            `Voice: ${voice}`,
          ].join('\n')),
      ],
    });
  }

  await postSubmittedApplication(
    app.id
  );

  return voice;
}

// =====================================================
// SCORING DATA
// =====================================================

function getInterviewSession(
  appId,
  staffId
) {
  let session =
    db.prepare(`
      SELECT *
      FROM interview_sessions
      WHERE app_id = ?
        AND staff_id = ?
    `)
      .get(
        appId,
        staffId
      );

  if (
    !session
  ) {
    db.prepare(`
      INSERT INTO interview_sessions(
        app_id,
        staff_id,
        current_category,
        finished
      )
      VALUES(
        ?,
        ?,
        -1,
        0
      )
    `).run(
      appId,
      staffId
    );

    session = {
      app_id:
        appId,

      staff_id:
        staffId,

      current_category:
        -1,

      finished:
        0,
    };
  }

  return session;
}

function getCategoryProgress(
  appId,
  staffId,
  categoryIndex
) {
  let progress =
    db.prepare(`
      SELECT *
      FROM interviewer_category_progress
      WHERE app_id = ?
        AND staff_id = ?
        AND category_index = ?
    `)
      .get(
        appId,
        staffId,
        categoryIndex
      );

  if (
    !progress
  ) {
    db.prepare(`
      INSERT INTO interviewer_category_progress(
        app_id,
        staff_id,
        category_index,
        selected_questions,
        current_pick_index,
        category_notes,
        finished
      )
      VALUES(
        ?,
        ?,
        ?,
        '[]',
        0,
        '',
        0
      )
    `).run(
      appId,
      staffId,
      categoryIndex
    );

    progress = {
      selected_questions:
        '[]',

      current_pick_index:
        0,

      category_notes:
        '',

      finished:
        0,
    };
  }

  return progress;
}

function selectedQuestionsFromProgress(
  progress
) {
  try {
    return JSON.parse(
      progress.selected_questions ||
      '[]'
    );
  } catch {
    return [];
  }
}

function getQuestionScore(
  appId,
  staffId,
  categoryIndex,
  questionNumber
) {
  return db.prepare(`
    SELECT *
    FROM question_scores
    WHERE app_id = ?
      AND staff_id = ?
      AND category_index = ?
      AND question_number = ?
  `).get(
    appId,
    staffId,
    categoryIndex,
    questionNumber
  );
}

function categoryScore(
  appId,
  staffId,
  categoryIndex
) {
  const progress =
    getCategoryProgress(
      appId,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestionsFromProgress(
      progress
    );

  let total = 0;
  let graded = 0;

  for (
    const questionNumber
    of selected
  ) {
    const row =
      getQuestionScore(
        appId,
        staffId,
        categoryIndex,
        questionNumber
      );

    if (
      Number.isInteger(
        row?.point
      )
    ) {
      total +=
        row.point;

      graded++;
    }
  }

  return {
    total,
    graded,
  };
}

function overallScore(
  appId,
  staffId
) {
  let total = 0;

  for (
    let i = 0;
    i < CATEGORY_COUNT;
    i++
  ) {
    total +=
      categoryScore(
        appId,
        staffId,
        i
      ).total;
  }

  return {
    total,
  };
}

// =====================================================
// INTERVIEW BOARD
// =====================================================

function openingBriefEmbed(app) {
  return new EmbedBuilder()
    .setTitle(
      '🛡️ Interview Opening Brief'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      OPENING_BRIEF,
      '',
      'Click **Next Category** when ready.',
    ].join('\n'));
}

function closingBriefEmbed(app) {
  return new EmbedBuilder()
    .setTitle(
      '🏁 Interview Closing Brief'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      CLOSING_BRIEF,
      '',
      'Review your scores and notes, then click **Finish My Scoring**.',
    ].join('\n'));
}

function categoryPickerEmbed(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestionsFromProgress(
      progress
    );

  const score =
    categoryScore(
      app.id,
      staffId,
      categoryIndex
    );

  const questions =
    category.questions
      .map(
        question => {
          const icon =
            selected.includes(
              question.number
            )
              ? '✅'
              : '⬜';

          return `${icon} **${question.number}.** ${question.text}`;
        }
      )
      .join(
        '\n\n'
      );

  return new EmbedBuilder()
    .setTitle(
      `${category.name}${
        category.code
          ? ` — ${category.code}`
          : ''
      }`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      '## Pick exactly 3 questions',
      '',
      'Each selected question is worth **1 point**.',
      '',
      questions,
      '',
      `**Selected:** ${selected.length}/3`,
      `**Graded:** ${score.graded}/3`,
      `**Category Score:** ${score.total}/3`,
      '',
      '**Category Notes:**',
      progress.category_notes ||
        '_No category notes yet._',
    ].join('\n'));
}

function categoryPickerRows(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestionsFromProgress(
      progress
    );

  const menu =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_three_questions:${app.id}:${categoryIndex}`
      )
      .setPlaceholder(
        'Pick exactly 3 questions'
      )
      .setMinValues(
        3
      )
      .setMaxValues(
        3
      )
      .addOptions(
        category.questions.map(
          question => ({
            label:
              `Question ${question.number}`,

            description:
              question.text
                .replace(
                  /\n/g,
                  ' '
                )
                .slice(
                  0,
                  90
                ),

            value:
              String(
                question.number
              ),

            default:
              selected.includes(
                question.number
              ),
          })
        )
      );

  return [
    new ActionRowBuilder()
      .addComponents(
        menu
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `ask_selected:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Ask Selected Questions'
          )
          .setEmoji(
            '🎤'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `category_notes:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Category Notes'
          )
          .setEmoji(
            '📝'
          )
          .setStyle(
            ButtonStyle.Secondary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `category_prev:${app.id}`
          )
          .setLabel(
            'Previous Category'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `category_next:${app.id}`
          )
          .setLabel(
            categoryIndex ===
              CATEGORY_COUNT -
              1
              ? 'Closing Brief'
              : 'Next Category'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

function selectedQuestionEmbed(
  app,
  staffId,
  categoryIndex,
  pickIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestionsFromProgress(
      progress
    );

  const questionNumber =
    selected[
      pickIndex
    ];

  const question =
    category.questions.find(
      q =>
        q.number ===
        questionNumber
    );

  const row =
    getQuestionScore(
      app.id,
      staffId,
      categoryIndex,
      questionNumber
    );

  return new EmbedBuilder()
    .setTitle(
      `${category.name} — Selected Question ${pickIndex + 1}/3`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      `## ${question?.number}. ${question?.text}`,
      '',
      `**Score:** ${
        Number.isInteger(
          row?.point
        )
          ? `${row.point}/1`
          : 'Not graded yet'
      }`,
      '',
      '**Question Notes:**',
      row?.notes ||
        '_No notes yet._',
    ].join('\n'));
}

function selectedQuestionRows(
  app,
  categoryIndex,
  pickIndex
) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `question_zero:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            '0 Points'
          )
          .setEmoji(
            '❌'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `question_one:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            '1 Point'
          )
          .setEmoji(
            '✅'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `question_note:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            'Add / Edit Notes'
          )
          .setEmoji(
            '📝'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `picked_prev:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            'Previous'
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            pickIndex === 0
          ),

        new ButtonBuilder()
          .setCustomId(
            `picked_next:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            pickIndex === 2
              ? 'Back to Category'
              : 'Next'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

function questionNotesModal(
  appId,
  categoryIndex,
  pickIndex,
  current = ''
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `question_note_modal:${appId}:${categoryIndex}:${pickIndex}`
      )
      .setTitle(
        'Question Notes'
      );

  const input =
    new TextInputBuilder()
      .setCustomId(
        'notes'
      )
      .setLabel(
        'Notes for this question'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(
        false
      )
      .setMaxLength(
        1500
      );

  if (
    current
  ) {
    input.setValue(
      current.slice(
        0,
        1500
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        input
      )
  );

  return modal;
}

function categoryNotesModal(
  appId,
  categoryIndex,
  current = ''
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `category_notes_modal:${appId}:${categoryIndex}`
      )
      .setTitle(
        'Category Notes'
      );

  const input =
    new TextInputBuilder()
      .setCustomId(
        'notes'
      )
      .setLabel(
        'Overall notes for this category'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(
        false
      )
      .setMaxLength(
        1500
      );

  if (
    current
  ) {
    input.setValue(
      current.slice(
        0,
        1500
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        input
      )
  );

  return modal;
}

function scoreProgressEmbed(
  app,
  staffId
) {
  const lines = [];
  let total = 0;

  for (
    let i = 0;
    i < CATEGORY_COUNT;
    i++
  ) {
    const score =
      categoryScore(
        app.id,
        staffId,
        i
      );

    total +=
      score.total;

    lines.push(
      `**${QUESTION_CATEGORIES[i].name}: ${score.total}/3** — ${score.graded}/3 graded`
    );
  }

  return new EmbedBuilder()
    .setTitle(
      '📊 My Interview Score'
    )
    .setDescription([
      ...lines,
      '',
      `## TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
    ].join('\n'));
}

function closingRows(app) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `category_prev:${app.id}`
          )
          .setLabel(
            'Previous Category'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `view_score_progress:${app.id}`
          )
          .setLabel(
            'View My Scores'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `finish_scoring:${app.id}`
          )
          .setLabel(
            'Finish My Scoring'
          )
          .setEmoji(
            '✅'
          )
          .setStyle(
            ButtonStyle.Success
          )
      ),
  ];
}

function allInterviewersFinished(appId) {
  const interviewers =
    getInterviewers(
      appId
    );

  if (
    !interviewers.length
  ) {
    return false;
  }

  return interviewers.every(
    staffId => {
      const row =
        db.prepare(`
          SELECT finished
          FROM interview_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `)
          .get(
            appId,
            staffId
          );

      return row?.finished === 1;
    }
  );
}

// =====================================================
// RESULTS
// =====================================================

async function postResults(appId) {
  const app =
    getApplication(
      appId
    );

  const channel =
    await fetchTextChannel(
      INTERVIEW_RESULTS_CHANNEL_ID
    );

  if (
    !app ||
    !channel
  ) {
    throw new Error(
      'Results channel not found.'
    );
  }

  let combinedTotal = 0;
  let combinedMax = 0;

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          app.mode === 'test'
            ? '🧪 TEST Interview Results'
            : '📊 Staff Interview Results'
        )
        .setDescription([
          `Applicant: <@${app.user_id}>`,
          `Application: #${app.id}`,
          '',
          '**Applicant does not see these scores.**',
        ].join('\n')),
    ],
  });

  for (
    const staffId
    of getInterviewers(
      app.id
    )
  ) {
    let total = 0;
    const fields = [];

    for (
      let i = 0;
      i < CATEGORY_COUNT;
      i++
    ) {
      const category =
        QUESTION_CATEGORIES[
          i
        ];

      const progress =
        getCategoryProgress(
          app.id,
          staffId,
          i
        );

      const selected =
        selectedQuestionsFromProgress(
          progress
        );

      const result =
        categoryScore(
          app.id,
          staffId,
          i
        );

      total +=
        result.total;

      const questionText =
        selected
          .map(
            qn => {
              const score =
                getQuestionScore(
                  app.id,
                  staffId,
                  i,
                  qn
                );

              return [
                `Q${qn}: **${
                  Number.isInteger(
                    score?.point
                  )
                    ? score.point
                    : 0
                }/1**`,

                `Notes: ${
                  score?.notes ||
                  'None'
                }`,
              ].join('\n');
            }
          )
          .join('\n\n');

      fields.push({
        name:
          `${category.name} — ${result.total}/3`,

        value:
          [
            questionText ||
              'No selected questions',

            '',

            `Category Notes: ${
              progress.category_notes ||
              'None'
            }`,
          ]
            .join('\n')
            .slice(
              0,
              1024
            ),
      });
    }

    combinedTotal += total;
    combinedMax += MAX_SCORE_PER_INTERVIEWER;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '📝 Interviewer Score'
          )
          .setDescription([
            `Applicant: <@${app.user_id}>`,
            `Interviewer: <@${staffId}>`,
            '',
            `## TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
          ].join('\n'))
          .addFields(
            fields
          ),
      ],
    });
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '📌 Combined Interview Score'
        )
        .setDescription([
          `Applicant: <@${app.user_id}>`,
          '',
          `## ${combinedTotal}/${combinedMax}`,
        ].join('\n')),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `final_accept:${app.id}`
            )
            .setLabel(
              'Accept'
            )
            .setEmoji(
              '✅'
            )
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `final_reject:${app.id}`
            )
            .setLabel(
              'Reject'
            )
            .setEmoji(
              '❌'
            )
            .setStyle(
              ButtonStyle.Danger
            ),

          new ButtonBuilder()
            .setCustomId(
              `final_review:${app.id}`
            )
            .setLabel(
              'Further Review'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  });
}

// =====================================================
// CLEANUP
// =====================================================

async function cleanupInterviewChannels(
  app,
  guild
) {
  const channelIds = [
    app.interview_voice_channel_id,
    app.scoring_channel_id,
    app.interview_text_channel_id,
  ];

  for (
    const channelId
    of channelIds
  ) {
    if (
      !channelId
    ) {
      continue;
    }

    const channel =
      await guild.channels
        .fetch(
          channelId
        )
        .catch(
          () =>
            null
        );

    if (
      channel
    ) {
      await channel
        .delete(
          `Cleaning interview ${app.id}`
        )
        .catch(
          () =>
            null
        );
    }
  }

  db.prepare(`
    UPDATE applications
    SET
      interview_voice_channel_id = NULL,
      scoring_channel_id = NULL,
      interview_text_channel_id = NULL
    WHERE id = ?
  `).run(
    app.id
  );
}

async function endInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    app.status !==
    'in_progress'
  ) {
    throw new Error(
      'Interview is not currently in progress.'
    );
  }

  if (
    !allInterviewersFinished(
      app.id
    )
  ) {
    throw new Error(
      'Every participating interviewer must finish scoring first.'
    );
  }

  await postResults(
    app.id
  );

  db.prepare(`
    UPDATE applications
    SET
      status = 'completed',
      completed_at = ?
    WHERE id = ?
  `).run(
    Date.now(),
    app.id
  );

  await postSubmittedApplication(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  await cleanupInterviewChannels(
    app,
    guild
  );
}

// =====================================================
// RESET TEST
// =====================================================

async function resetTestData(
  guild
) {
  const apps =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'test'
    `)
      .all();

  for (
    const app
    of apps
  ) {
    await cleanupInterviewChannels(
      app,
      guild
    );

    db.prepare(`
      DELETE FROM approvals
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM interviewers
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM question_scores
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM interviewer_category_progress
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM interview_sessions
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM applications
      WHERE id = ?
    `).run(
      app.id
    );
  }

  const testPanelId =
    getSetting(
      'test_application_channel_id'
    );

  if (
    testPanelId
  ) {
    const channel =
      await guild.channels
        .fetch(
          testPanelId
        )
        .catch(
          () =>
            null
        );

    if (
      channel
    ) {
      await channel
        .delete(
          'Resetting test'
        )
        .catch(
          () =>
            null
        );
    }
  }

  setSetting(
    'test_application_channel_id',
    ''
  );

  setSetting(
    'system_mode',
    'closed'
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
      await ensureManagementPanel();
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
          .fetch(
            GUILD_ID
          );

      const member =
        interaction.member ||
        await guild.members
          .fetch(
            interaction.user.id
          )
          .catch(
            () =>
              null
          );

      // ================================================
      // MANAGEMENT
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_test_mode'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicApplicationChannel(
          guild
        );

        setSetting(
          'system_mode',
          'test'
        );

        await refreshManagementPanel();

        return safeEphemeral(
          interaction,
          '🧪 Testing Mode enabled. Click Choose Test Applicant next.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_test_applicant'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        if (
          getSetting(
            'system_mode'
          ) !== 'test'
        ) {
          return safeEphemeral(
            interaction,
            'Enable Testing Mode first.'
          );
        }

        return interaction.reply({
          content:
            'Choose the test applicant:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    'select_test_applicant'
                  )
                  .setPlaceholder(
                    'Choose test applicant'
                  )
                  .setMinValues(
                    1
                  )
                  .setMaxValues(
                    1
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId ===
          'select_test_applicant'
      ) {
        const userId =
          interaction.values[0];

        const channel =
          await createTestApplicantChannel(
            guild,
            userId
          );

        return interaction.update({
          content:
            `✅ Test applicant selected: <@${userId}>\n${channel}`,

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_public_open'
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const channel =
          await createPublicApplicationChannel(
            guild
          );

        setSetting(
          'system_mode',
          'public'
        );

        await refreshManagementPanel();

        return safeEphemeral(
          interaction,
          `✅ Public applications open: ${channel}`
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_close'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicApplicationChannel(
          guild
        );

        setSetting(
          'system_mode',
          'closed'
        );

        await refreshManagementPanel();

        return safeEphemeral(
          interaction,
          '🔴 Applications closed.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_reset_test'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        await resetTestData(
          guild
        );

        await refreshManagementPanel();

        return interaction.editReply(
          '✅ Test data reset.'
        );
      }

      // ================================================
      // APPLY
      // ================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
            'apply_test' ||
          interaction.customId ===
            'apply_public'
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
          return safeEphemeral(
            interaction,
            'Testing Mode is not enabled.'
          );
        }

        if (
          mode === 'real' &&
          getSetting(
            'system_mode'
          ) !== 'public'
        ) {
          return safeEphemeral(
            interaction,
            'Applications are closed.'
          );
        }

        const active =
          getActiveApplicationForUser(
            interaction.user.id,
            mode
          );

        if (
          active
        ) {
          return safeEphemeral(
            interaction,
            `You already have an active application #${active.id}.`
          );
        }

        return interaction.showModal(
          buildApplicationModal(
            mode
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'application_modal:'
        )
      ) {
        const mode =
          interaction.customId
            .split(
              ':'
            )[1];

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

        return interaction.reply({
          ...buildWeekPicker(
            app
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ================================================
      // WEEK / DATE / TIME
      // ================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_week:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This week picker is not yours.'
          );
        }

        return interaction.update(
          buildDatePicker(
            app,
            Number(
              interaction.values[0]
            )
          )
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_weeks:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This week picker is not yours.'
          );
        }

        return interaction.update(
          buildWeekPicker(
            app
          )
        );
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_date:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This date picker is not yours.'
          );
        }

        return interaction.update(
          buildTimePicker(
            app,
            interaction.values[0]
          )
        );
      }

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
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This time picker is not yours.'
          );
        }

        return interaction.update(
          buildTimezonePicker(
            app,
            dateISO,
            interaction.values[0]
          )
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_times:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          buildTimePicker(
            app,
            dateISO
          )
        );
      }

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
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !ensureApplicantOwnsPicker(
            interaction,
            app
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return saveSchedule(
          interaction,
          app,
          dateISO,
          timeValue,
          interaction.values[0]
        );
      }

      // ================================================
      // APPROVE
      // ================================================

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
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          INSERT OR IGNORE INTO approvals(
            app_id,
            staff_id,
            created_at
          )
          VALUES(
            ?,
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id,
          Date.now()
        );

        db.prepare(`
          INSERT OR IGNORE INTO interviewers(
            app_id,
            staff_id,
            added_by
          )
          VALUES(
            ?,
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id,
          interaction.user.id
        );

        const approval =
          await getApprovalStatus(
            app.id,
            guild
          );

        await postSubmittedApplication(
          app.id
        );

        if (
          approval.confirmed
        ) {
          await confirmInterview(
            app.id,
            guild
          );

          return safeEphemeral(
            interaction,
            '✅ Interview confirmed. Private interview and scoring channels were created.'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ Confirmation recorded. ${approval.seniorCount}/2 Senior Staff confirmations.`
        );
      }

      // ================================================
      // ADD SENIOR STAFF
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'add_senior_staff:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          interaction.channelId !==
          app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This only works inside the scoring channel.'
          );
        }

        return interaction.reply({
          content:
            'Choose one or more Senior Staff:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    `select_add_senior:${app.id}`
                  )
                  .setPlaceholder(
                    'Choose Senior Staff'
                  )
                  .setMinValues(
                    1
                  )
                  .setMaxValues(
                    10
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId.startsWith(
          'select_add_senior:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        const added = [];
        const rejected = [];

        for (
          const userId
          of interaction.values
        ) {
          const selectedMember =
            await guild.members
              .fetch(
                userId
              )
              .catch(
                () =>
                  null
              );

          if (
            !selectedMember ||
            !isSenior(
              selectedMember
            )
          ) {
            rejected.push(
              userId
            );

            continue;
          }

          db.prepare(`
            INSERT OR IGNORE INTO interviewers(
              app_id,
              staff_id,
              added_by
            )
            VALUES(
              ?,
              ?,
              ?
            )
          `).run(
            app.id,
            userId,
            interaction.user.id
          );

          added.push(
            userId
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return interaction.update({
          content: [
            added.length
              ? `✅ Added: ${added.map(id => `<@${id}>`).join(', ')}`
              : 'No Senior Staff were added.',

            rejected.length
              ? `\n❌ Not Senior Staff: ${rejected.map(id => `<@${id}>`).join(', ')}`
              : '',
          ].join(''),

          components: [],
        });
      }

      // ================================================
      // RESCHEDULE
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reschedule_request:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'needs_time'
          WHERE id = ?
        `).run(
          app.id
        );

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(
              () =>
                null
            );

        if (
          user
        ) {
          await user.send({
            content:
              '📅 Staff needs you to choose a different interview week/date/time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `applicant_reschedule:${app.id}`
                    )
                    .setLabel(
                      'Choose New Week & Time'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          }).catch(
            () =>
              null
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          '📅 Applicant was asked to choose another week/date/time.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'applicant_reschedule:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            'Applicant only.'
          );
        }

        return interaction.reply({
          ...buildWeekPicker(
            app
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ================================================
      // STAFF CANCEL
      // ================================================

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
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          DELETE FROM approvals
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM interviewers
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM question_scores
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM interviewer_category_progress
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM interview_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        const approval =
          await getApprovalStatus(
            app.id,
            guild
          );

        if (
          !approval.confirmed &&
          [
            'confirmed',
            'in_progress',
          ].includes(
            app.status
          )
        ) {
          await cleanupInterviewChannels(
            app,
            guild
          );

          db.prepare(`
            UPDATE applications
            SET status = 'pending'
            WHERE id = ?
          `).run(
            app.id
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          '✅ You were removed from this interview.'
        );
      }

      // ================================================
      // START INTERVIEW
      // ONLY SCORING CHANNEL
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'owner_start:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Only Owner or Co-Owner can start the interview.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          interaction.channelId !==
          app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Start Interview only works inside the private scoring channel.'
          );
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        try {
          const voice =
            await startInterview(
              appId,
              guild
            );

          return interaction.editReply(
            `🎙️ Interview started. Voice: ${voice}`
          );
        } catch (error) {
          return interaction.editReply(
            `❌ ${error.message}`
          );
        }
      }

      // ================================================
      // OPEN INTERVIEW BOARD
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'open_interview_board:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ You are not a participating interviewer.'
          );
        }

        const session =
          getInterviewSession(
            app.id,
            interaction.user.id
          );

        const current =
          session.current_category;

        if (
          current === -1
        ) {
          return interaction.reply({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `category_next:${app.id}`
                    )
                    .setLabel(
                      'Next Category'
                    )
                    .setEmoji(
                      '➡️'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],

            flags:
              MessageFlags.Ephemeral,
          });
        }

        if (
          current >=
          CATEGORY_COUNT
        ) {
          return interaction.reply({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              closingRows(
                app
              ),

            flags:
              MessageFlags.Ephemeral,
          });
        }

        return interaction.reply({
          embeds: [
            categoryPickerEmbed(
              app,
              interaction.user.id,
              current
            ),
          ],

          components:
            categoryPickerRows(
              app,
              interaction.user.id,
              current
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ================================================
      // CATEGORY NAVIGATION
      // ================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'category_prev:'
          ) ||
          interaction.customId.startsWith(
            'category_next:'
          )
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ You are not a participating interviewer.'
          );
        }

        const session =
          getInterviewSession(
            app.id,
            interaction.user.id
          );

        const delta =
          interaction.customId.startsWith(
            'category_next:'
          )
            ? 1
            : -1;

        if (
          delta > 0 &&
          session.current_category >=
            0 &&
          session.current_category <
            CATEGORY_COUNT
        ) {
          const progress =
            getCategoryProgress(
              app.id,
              interaction.user.id,
              session.current_category
            );

          const selected =
            selectedQuestionsFromProgress(
              progress
            );

          const score =
            categoryScore(
              app.id,
              interaction.user.id,
              session.current_category
            );

          if (
            selected.length !==
            QUESTIONS_PER_CATEGORY
          ) {
            return safeEphemeral(
              interaction,
              '❌ Pick exactly 3 questions before moving to the next category.'
            );
          }

          if (
            score.graded !==
            QUESTIONS_PER_CATEGORY
          ) {
            return safeEphemeral(
              interaction,
              '❌ Grade all 3 selected questions before moving to the next category.'
            );
          }
        }

        const next =
          Math.max(
            -1,
            Math.min(
              CATEGORY_COUNT,
              session.current_category +
                delta
            )
          );

        db.prepare(`
          UPDATE interview_sessions
          SET current_category = ?
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          next,
          app.id,
          interaction.user.id
        );

        if (
          next === -1
        ) {
          return interaction.update({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `category_next:${app.id}`
                    )
                    .setLabel(
                      'Next Category'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          });
        }

        if (
          next >=
          CATEGORY_COUNT
        ) {
          return interaction.update({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              closingRows(
                app
              ),
          });
        }

        return interaction.update({
          embeds: [
            categoryPickerEmbed(
              app,
              interaction.user.id,
              next
            ),
          ],

          components:
            categoryPickerRows(
              app,
              interaction.user.id,
              next
            ),
        });
      }

      // ================================================
      // PICK EXACTLY 3 QUESTIONS
      // ================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_three_questions:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ You are not a participating interviewer.'
          );
        }

        if (
          interaction.values.length !==
          QUESTIONS_PER_CATEGORY
        ) {
          return safeEphemeral(
            interaction,
            '❌ Choose exactly 3 questions.'
          );
        }

        const selected =
          interaction.values.map(
            Number
          );

        db.prepare(`
          UPDATE interviewer_category_progress
          SET
            selected_questions = ?,
            current_pick_index = 0,
            finished = 0
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
        `).run(
          JSON.stringify(
            selected
          ),
          app.id,
          interaction.user.id,
          categoryIndex
        );

        const placeholders =
          selected
            .map(
              () =>
                '?'
            )
            .join(
              ','
            );

        db.prepare(`
          DELETE FROM question_scores
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
            AND question_number NOT IN (${placeholders})
        `).run(
          app.id,
          interaction.user.id,
          categoryIndex,
          ...selected
        );

        return interaction.update({
          embeds: [
            categoryPickerEmbed(
              app,
              interaction.user.id,
              categoryIndex
            ),
          ],

          components:
            categoryPickerRows(
              app,
              interaction.user.id,
              categoryIndex
            ),
        });
      }

      // ================================================
      // ASK SELECTED QUESTIONS
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'ask_selected:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ You are not a participating interviewer.'
          );
        }

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        const selected =
          selectedQuestionsFromProgress(
            progress
          );

        if (
          selected.length !==
          QUESTIONS_PER_CATEGORY
        ) {
          return safeEphemeral(
            interaction,
            '❌ Pick exactly 3 questions first.'
          );
        }

        return interaction.update({
          embeds: [
            selectedQuestionEmbed(
              app,
              interaction.user.id,
              categoryIndex,
              0
            ),
          ],

          components:
            selectedQuestionRows(
              app,
              categoryIndex,
              0
            ),
        });
      }

      // ================================================
      // QUESTION SCORE
      // ================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'question_zero:'
          ) ||
          interaction.customId.startsWith(
            'question_one:'
          )
        )
      ) {
        const parts =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              parts[1]
            )
          );

        const categoryIndex =
          Number(
            parts[2]
          );

        const pickIndex =
          Number(
            parts[3]
          );

        const point =
          interaction.customId.startsWith(
            'question_one:'
          )
            ? 1
            : 0;

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        const selected =
          selectedQuestionsFromProgress(
            progress
          );

        const questionNumber =
          selected[
            pickIndex
          ];

        const current =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            questionNumber
          );

        db.prepare(`
          INSERT INTO question_scores(
            app_id,
            staff_id,
            category_index,
            question_number,
            point,
            notes
          )
          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )

          ON CONFLICT(
            app_id,
            staff_id,
            category_index,
            question_number
          )

          DO UPDATE SET
            point = excluded.point
        `).run(
          app.id,
          interaction.user.id,
          categoryIndex,
          questionNumber,
          point,
          current?.notes ||
            ''
        );

        return interaction.update({
          embeds: [
            selectedQuestionEmbed(
              app,
              interaction.user.id,
              categoryIndex,
              pickIndex
            ),
          ],

          components:
            selectedQuestionRows(
              app,
              categoryIndex,
              pickIndex
            ),
        });
      }

      // ================================================
      // QUESTION NOTES
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'question_note:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
          pickIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        const pickIndex =
          Number(
            pickIndexRaw
          );

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        const selected =
          selectedQuestionsFromProgress(
            progress
          );

        const qn =
          selected[
            pickIndex
          ];

        const current =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            qn
          );

        return interaction.showModal(
          questionNotesModal(
            app.id,
            categoryIndex,
            pickIndex,
            current?.notes ||
              ''
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'question_note_modal:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
          pickIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        const pickIndex =
          Number(
            pickIndexRaw
          );

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        const selected =
          selectedQuestionsFromProgress(
            progress
          );

        const qn =
          selected[
            pickIndex
          ];

        const notes =
          interaction.fields
            .getTextInputValue(
              'notes'
            )
            .trim();

        const current =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            qn
          );

        db.prepare(`
          INSERT INTO question_scores(
            app_id,
            staff_id,
            category_index,
            question_number,
            point,
            notes
          )
          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )

          ON CONFLICT(
            app_id,
            staff_id,
            category_index,
            question_number
          )

          DO UPDATE SET
            notes = excluded.notes
        `).run(
          app.id,
          interaction.user.id,
          categoryIndex,
          qn,
          Number.isInteger(
            current?.point
          )
            ? current.point
            : null,
          notes
        );

        return safeEphemeral(
          interaction,
          `✅ Notes saved for Question ${qn}.`
        );
      }

      // ================================================
      // SELECTED QUESTION NAVIGATION
      // ================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'picked_prev:'
          ) ||
          interaction.customId.startsWith(
            'picked_next:'
          )
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
          pickIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        const pickIndex =
          Number(
            pickIndexRaw
          );

        if (
          interaction.customId.startsWith(
            'picked_prev:'
          )
        ) {
          const previous =
            Math.max(
              0,
              pickIndex - 1
            );

          return interaction.update({
            embeds: [
              selectedQuestionEmbed(
                app,
                interaction.user.id,
                categoryIndex,
                previous
              ),
            ],

            components:
              selectedQuestionRows(
                app,
                categoryIndex,
                previous
              ),
          });
        }

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        const selected =
          selectedQuestionsFromProgress(
            progress
          );

        const currentQn =
          selected[
            pickIndex
          ];

        const currentScore =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            currentQn
          );

        if (
          !Number.isInteger(
            currentScore?.point
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Grade this question 0 or 1 before continuing.'
          );
        }

        if (
          pickIndex >=
          QUESTIONS_PER_CATEGORY -
            1
        ) {
          return interaction.update({
            embeds: [
              categoryPickerEmbed(
                app,
                interaction.user.id,
                categoryIndex
              ),
            ],

            components:
              categoryPickerRows(
                app,
                interaction.user.id,
                categoryIndex
              ),
          });
        }

        const next =
          pickIndex +
          1;

        return interaction.update({
          embeds: [
            selectedQuestionEmbed(
              app,
              interaction.user.id,
              categoryIndex,
              next
            ),
          ],

          components:
            selectedQuestionRows(
              app,
              categoryIndex,
              next
            ),
        });
      }

      // ================================================
      // CATEGORY NOTES
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'category_notes:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        return interaction.showModal(
          categoryNotesModal(
            app.id,
            categoryIndex,
            progress.category_notes ||
              ''
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'category_notes_modal:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryIndexRaw
          );

        const notes =
          interaction.fields
            .getTextInputValue(
              'notes'
            )
            .trim();

        db.prepare(`
          UPDATE interviewer_category_progress
          SET category_notes = ?
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
        `).run(
          notes,
          app.id,
          interaction.user.id,
          categoryIndex
        );

        return safeEphemeral(
          interaction,
          '✅ Category notes saved.'
        );
      }

      // ================================================
      // VIEW SCORE
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'view_score_progress:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        return interaction.reply({
          embeds: [
            scoreProgressEmbed(
              app,
              interaction.user.id
            ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ================================================
      // FINISH SCORING
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'finish_scoring:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        const session =
          getInterviewSession(
            app.id,
            interaction.user.id
          );

        if (
          session.current_category <
          CATEGORY_COUNT
        ) {
          return safeEphemeral(
            interaction,
            '❌ Reach the Closing Brief first.'
          );
        }

        for (
          let i = 0;
          i < CATEGORY_COUNT;
          i++
        ) {
          const progress =
            getCategoryProgress(
              app.id,
              interaction.user.id,
              i
            );

          const selected =
            selectedQuestionsFromProgress(
              progress
            );

          const score =
            categoryScore(
              app.id,
              interaction.user.id,
              i
            );

          if (
            selected.length !==
            QUESTIONS_PER_CATEGORY
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: choose exactly 3 questions.`
            );
          }

          if (
            score.graded !==
            QUESTIONS_PER_CATEGORY
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: grade all 3 questions.`
            );
          }
        }

        const total =
          overallScore(
            app.id,
            interaction.user.id
          ).total;

        db.prepare(`
          UPDATE interview_sessions
          SET finished = 1
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        return safeEphemeral(
          interaction,
          `✅ Your scoring is finished. Final score: **${total}/${MAX_SCORE_PER_INTERVIEWER}**.`
        );
      }

      // ================================================
      // END INTERVIEW
      // ONLY SCORING CHANNEL
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'owner_end:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          interaction.channelId !==
          app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ End Interview only works inside the private scoring channel.'
          );
        }

        if (
          !allInterviewersFinished(
            app.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Every participating interviewer must finish scoring first.'
          );
        }

        return interaction.reply({
          content: [
            '🏁 **End this interview?**',
            '',
            `Scores and notes will first be saved in <#${INTERVIEW_RESULTS_CHANNEL_ID}>.`,
            '',
            'Then these temporary channels will be deleted:',
            '• Interview text channel',
            '• Scoring channel',
            '• Voice channel',
          ].join('\n'),

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_owner_end:${app.id}`
                  )
                  .setLabel(
                    'Yes — End Interview'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `cancel_owner_end:${app.id}`
                  )
                  .setLabel(
                    'Keep Interview Open'
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
          'cancel_owner_end:'
        )
      ) {
        return interaction.update({
          content:
            '✅ Interview will remain open.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_owner_end:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        await interaction.deferUpdate();

        try {
          await endInterview(
            appId,
            guild
          );

          return interaction.editReply({
            content:
              '✅ Interview ended. Scores saved and all temporary interview channels deleted.',

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

      // ================================================
      // FINAL RESULT
      // ================================================

      if (
        interaction.isButton() &&
        /^final_(accept|reject|review):/.test(
          interaction.customId
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const [
          actionPart,
          appIdRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const action =
          actionPart.replace(
            'final_',
            ''
          );

        const status =
          action === 'accept'
            ? 'accepted'
            : action === 'reject'
              ? 'rejected'
              : 'further_review';

        db.prepare(`
          UPDATE applications
          SET status = ?
          WHERE id = ?
        `).run(
          status,
          app.id
        );

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          `✅ Application marked as **${statusLabel(status)}**. Applicant was not shown the result.`
        );
      }

    } catch (error) {
      console.error(
        'Interaction error:',
        error
      );

      await safeEphemeral(
        interaction,
        `❌ Something went wrong: ${error.message}`
      );
    }
  }
);

client.login(
  DISCORD_TOKEN
);
