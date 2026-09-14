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
const SCORING_CATEGORY_ID = '1548862844186001478';

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

CREATE TABLE IF NOT EXISTS category_scores (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  category_index INTEGER NOT NULL,
  score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(app_id, staff_id, category_index)
);

CREATE TABLE IF NOT EXISTS question_sessions (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT -1,
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

function ensureColumn(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  if (!columns.some((c) => c.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

ensureColumn(
  'applications',
  'notification_message_id',
  'TEXT'
);

ensureColumn(
  'applications',
  'scoring_channel_id',
  'TEXT'
);

ensureColumn(
  'applications',
  'interview_text_channel_id',
  'TEXT'
);

ensureColumn(
  'applications',
  'interview_voice_channel_id',
  'TEXT'
);

ensureColumn(
  'interviewers',
  'added_by',
  'TEXT'
);

function getSetting(key, fallback = null) {
  const row = db
    .prepare(
      'SELECT value FROM settings WHERE key = ?'
    )
    .get(key);

  return row
    ? row.value
    : fallback;
}

function setSetting(key, value) {
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

if (!getSetting('system_mode')) {
  setSetting(
    'system_mode',
    'closed'
  );
}

// =====================================================
// OPENING BRIEF
// =====================================================

const OPENING_BRIEF = [
  '**Welcome to the Moderator Application Process!**',

  '',

  'Thank you for your interest in helping make our SMP a fun, fair, and welcoming community. Moderators are expected to be mature, active, respectful, and capable of handling situations professionally.',

  '',

  'Please answer all questions honestly and in detail.',

  '',

  'You have about **1 minute to answer each question**. Questions that are not answered, or have a 5–10 second delay, may be skipped and can impact your score.',

  '',

  '**This meeting is recorded and reviewed.**',

  '',

  'You will be graded based on your performance during the meeting.',

  '',

  '🛡️ **Trial Moderator Promotion Board**',
].join('\n');

// =====================================================
// CLOSING BRIEF
// =====================================================

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

// =====================================================
// EXACT INTERVIEW QUESTIONS
// =====================================================

const QUESTION_CATEGORIES = [
  {
    name: '📖 General Knowledge',
    code: 'DE',

    questions: [
      {
        number: 1,
        text: 'Why do you want to become a Moderator?',
      },

      {
        number: 2,
        text: 'What do you believe the role of a moderator is?',
      },

      {
        number: 3,
        text: 'What qualities make an excellent moderator?',
      },

      {
        number: 4,
        text: 'What does fairness mean to you?',
      },

      {
        number: 5,
        text: 'Why is professionalism important when moderating a community?',
      },
    ],
  },

  {
    name: '🤝 Community & Leadership',
    code: '',

    questions: [
      {
        number: 6,
        text: 'How would you help new players feel welcomed on the SMP?',
      },

      {
        number: 7,
        text: 'What would you do to improve the community experience?',
      },

      {
        number: 8,
        text: 'How do you handle disagreements with other people?',
      },

      {
        number: 9,
        text: 'What makes a good leader?',
      },

      {
        number: 10,
        text: 'Why should the staff team trust you with moderation permissions?',
      },
    ],
  },

  {
    name: '⚖️ Rule Enforcement Scenarios',
    code: 'KI',

    questions: [
      {
        number: 12,
        text: 'You witness a player using inappropriate language in global chat. What actions would you take?',
      },

      {
        number: 13,
        text: 'A player is intentionally trying to provoke others into breaking rules. How would you deal with this?',
      },

      {
        number: 14,
        text: 'A player is bypassing chat filters and is repeatedly spamming chat after multiple warnings. How would you handle the situation? send inappropriate messages. What would you do?',
      },

      {
        number: 15,
        text: 'Several players report someone for hacking, but there is no evidence. What steps would you take before making a decision?',
      },
    ],
  },

  {
    name: '🔥 Advanced Scenario Questions',
    code: 'DE',

    questions: [
      {
        number: 16,
        text: 'One of your close friends is caught cheating. They ask you not to report them. What would you do and why?',
      },

      {
        number: 17,
        text: 'A popular player is breaking rules, but many community members defend them because they are well-known. How would you handle the situation?',
      },

      {
        number: 18,
        text: 'You accidentally punish the wrong player. What would you do next?',
      },

      {
        number: 19,
        text: 'Another moderator gives a punishment that you believe is unfair. How would you address the situation?',
      },

      {
        number: 20,
        text: 'You are the only staff member online and multiple issues happen at the same time:\n• A player is spamming.\n• Someone reports a hacker.\n• Two players are arguing in chat.\nHow would you prioritize and handle each situation?',
      },
    ],
  },

  {
    name: '🧠 Judgment & Decision Making',
    code: '',

    questions: [
      {
        number: 21,
        text: 'What would you do if you were unsure how to handle a moderation situation?',
      },

      {
        number: 22,
        text: 'When should a moderator ask for help from higher-ranking staff?',
      },

      {
        number: 23,
        text: 'What is more important:\n• Being liked by players\n• Enforcing rules fairly\nExplain your answer.',
      },

      {
        number: 24,
        text: 'How would you respond to a player who becomes angry after receiving a punishment?',
      },

      {
        number: 25,
        text: 'What would you do if someone accused you of staff abuse?',
      },
    ],
  },

  {
    name: '🚨 Serious Staff Scenarios',
    code: '',

    questions: [
      {
        number: 26,
        text: 'You discover another staff member abusing their permissions. What actions would you take?',
      },

      {
        number: 27,
        text: 'A player privately tells you they found a duplication exploit that could harm the economy. What would you do?',
      },

      {
        number: 28,
        text: 'A player threatens to leave the server unless their punishment is removed. How would you respond?',
      },

      {
        number: 29,
        text: 'You find evidence that a staff member is leaking private staff information. What would you do?',
      },

      {
        number: 30,
        text: 'A player creates multiple alternate accounts to evade punishments. How would you investigate and handle the situation?',
      },
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

const ALL_QUESTIONS =
  QUESTION_CATEGORIES.flatMap(
    (
      category,
      categoryIndex
    ) =>
      category.questions.map(
        question => ({
          ...question,

          categoryIndex,

          categoryName:
            category.name,

          categoryCode:
            category.code,
        })
      )
  );

const CATEGORY_COUNT =
  QUESTION_CATEGORIES.length;

const MAX_SCORE_PER_INTERVIEWER =
  CATEGORY_COUNT * 3;

// =====================================================
// TEST CHECKLIST
// =====================================================

const TEST_CHECKS = [
  [
    'application_panel',
    'Application panel',
  ],

  [
    'application_form',
    'Application form',
  ],

  [
    'application_submission',
    'Application submission',
  ],

  [
    'staff_approvals',
    'Staff approvals',
  ],

  [
    'owner_override',
    'Owner/Co-Owner override',
  ],

  [
    'add_senior_staff',
    'Owner/Co-Owner adds Senior Staff',
  ],

  [
    'rescheduling',
    'Rescheduling',
  ],

  [
    'timezone_conversion',
    'Time-zone conversion',
  ],

  [
    'confirmation',
    'Interview confirmation',
  ],

  [
    'voice',
    'Voice interview channel',
  ],

  [
    'questions',
    'Question navigation',
  ],

  [
    'category_scoring',
    'Category scoring',
  ],

  [
    'category_notes',
    'Category notes',
  ],

  [
    'closing_brief',
    'Closing brief',
  ],

  [
    'results',
    'Permanent results',
  ],

  [
    'cleanup',
    'Temporary channel cleanup',
  ],
];

function markTestCheck(key) {
  if (
    !TEST_CHECKS.some(
      ([k]) =>
        k === key
    )
  ) {
    return;
  }

  db.prepare(`
    INSERT INTO test_checks(
      check_key,
      passed,
      updated_at
    )
    VALUES(
      ?,
      1,
      ?
    )

    ON CONFLICT(check_key)
    DO UPDATE SET
      passed = 1,
      updated_at = excluded.updated_at
  `).run(
    key,
    Date.now()
  );
}

function resetTestChecks() {
  db.prepare(
    'DELETE FROM test_checks'
  ).run();
}

function checklistText() {
  const passed =
    new Set(
      db.prepare(`
        SELECT check_key
        FROM test_checks
        WHERE passed = 1
      `)
        .all()
        .map(
          row =>
            row.check_key
        )
    );

  const lines =
    TEST_CHECKS.map(
      (
        [
          key,
          label,
        ]
      ) =>
        `${passed.has(key) ? '✅' : '⬜'} ${label}`
    );

  const count =
    TEST_CHECKS.filter(
      ([key]) =>
        passed.has(key)
    ).length;

  return [
    ...lines,

    '',

    `**Testing Progress: ${count}/${TEST_CHECKS.length}**`,
  ].join('\n');
}

// =====================================================
// DATE/TIME PICKERS
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

function minimumSelectableDate(
  app
) {
  const today =
    DateTime.now()
      .setZone(
        'Pacific/Honolulu'
      )
      .startOf(
        'day'
      );

  return app.mode ===
    'real'
    ? today.plus({
        days: 7,
      })
    : today;
}

function buildDatePicker(
  app,
  page = 0
) {
  page =
    Math.max(
      0,
      Math.min(
        MAX_DATE_PAGES - 1,
        Number(page) || 0
      )
    );

  const start =
    minimumSelectableDate(
      app
    ).plus({
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
        'Scroll and choose a date'
      )
      .addOptions(
        options
      );

  return {
    content: [
      '📅 **Choose Interview Date**',

      '',

      'Open the menu and scroll through the dates.',

      app.mode === 'real'
        ? '\nReal interviews must be at least **7 days in advance**.'
        : '',
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
    content: [
      `📅 **${DateTime.fromISO(
        dateISO
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**`,

      '',

      '🕐 **Choose Interview Time**',
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
              `back_dates:${app.id}`
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
      (
        [
          value,
        ]
      ) =>
        value ===
        timeValue
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
      `📅 **${DateTime.fromISO(
        dateISO
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**`,

      `🕐 **${friendly}**`,

      '',

      '🌎 **Choose Your Time Zone**',
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
              `back_times:${app.id}:${dateISO}`
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

  const dateTime =
    DateTime.fromISO(
      `${dateISO}T${timeValue}:00`,
      {
        zone,
      }
    );

  if (
    !dateTime.isValid
  ) {
    return null;
  }

  return Math.floor(
    dateTime.toSeconds()
  );
}

// =====================================================
// HELPERS
// =====================================================

function unixNow() {
  return Math.floor(
    Date.now() /
      1000
  );
}

function slugify(name) {
  return (
    (
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
    'applicant'
  );
}

function statusLabel(
  status
) {
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

  return (
    map[status] ||
    status
  );
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

function isOwner(
  member
) {
  return hasRole(
    member,
    OWNER_ROLE_ID
  );
}

function isCoOwner(
  member
) {
  return hasRole(
    member,
    CO_OWNER_ROLE_ID
  );
}

function isSenior(
  member
) {
  return hasRole(
    member,
    SENIOR_STAFF_ROLE_ID
  );
}

function isOwnerOrCoOwner(
  member
) {
  return (
    isOwner(
      member
    ) ||
    isCoOwner(
      member
    )
  );
}

function isAuthorizedStaff(
  member
) {
  return (
    isOwner(
      member
    ) ||
    isCoOwner(
      member
    ) ||
    isSenior(
      member
    )
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
        () => null
      );
  }

  return interaction
    .reply({
      content,
      flags:
        MessageFlags.Ephemeral,
    })
    .catch(
      () => null
    );
}

async function fetchTextChannel(
  id
) {
  if (!id) {
    return null;
  }

  const channel =
    await client.channels
      .fetch(
        id
      )
      .catch(
        () => null
      );

  return channel?.isTextBased()
    ? channel
    : null;
}

function getApplication(
  appId
) {
  return db
    .prepare(
      'SELECT * FROM applications WHERE id = ?'
    )
    .get(
      appId
    );
}

function getActiveApplicationForUser(
  userId,
  mode
) {
  return db
    .prepare(`
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
    `)
    .get(
      userId,
      mode
    );
}

function getApprovals(
  appId
) {
  return db
    .prepare(`
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

function getInterviewers(
  appId
) {
  return db
    .prepare(`
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

async function deleteMessageIfPossible(
  channelId,
  messageId
) {
  if (
    !channelId ||
    !messageId
  ) {
    return;
  }

  const channel =
    await fetchTextChannel(
      channelId
    );

  if (!channel) {
    return;
  }

  const msg =
    await channel.messages
      .fetch(
        messageId
      )
      .catch(
        () => null
      );

  if (msg) {
    await msg
      .delete()
      .catch(
        () => null
      );
  }
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

      '🎙️ Interview Start/End controls only appear inside each private scoring channel.',
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
          .setEmoji('🧪')
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
          .setEmoji('👤')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_checklist'
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
            'manage_public_open'
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
            'manage_close'
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
            'manage_reset_test'
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
        limit: 50,
      })
      .catch(
        () => null
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

  if (existing) {
    await existing
      .edit({
        embeds: [
          managementEmbed(),
        ],

        components:
          managementRows(),
      })
      .catch(
        () => null
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

      '**Steps**',

      '1. Enter your age and moderation experience.',

      '2. Choose your interview date.',

      '3. Choose your interview time.',

      '4. Choose your time zone.',

      '',

      isTest
        ? '⚡ Testing Mode can start immediately.'
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
          () => null
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
        () => null
      );

  if (
    channel
  ) {
    await channel
      .delete(
        'Staff applications closed'
      )
      .catch(
        () => null
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
        () => null
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
          () => null
        );

    if (
      old
    ) {
      await old
        .delete(
          'Replacing test application channel'
        )
        .catch(
          () => null
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

  markTestCheck(
    'application_panel'
  );

  return channel;
}

function buildApplicationModal(
  mode
) {
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

// =====================================================
// SUBMITTED APPLICATION DISPLAY
// =====================================================

async function postSubmittedApplication(
  appId
) {
  const app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    return;
  }

  const channel =
    await fetchTextChannel(
      SUBMITTED_APPLICATIONS_CHANNEL_ID
    );

  if (
    !channel
  ) {
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
                  .join('\n')
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
                  .join('\n')
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
    app.mode ===
    'test'
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
            .setEmoji('✅')
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
            )
        )
    );
  }

  if (
    app.mode ===
      'test' &&
    ![
      'in_progress',
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
              `test_start_now:${app.id}`
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
        .catch(
          () => null
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
// SCHEDULE SAVE
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
    app.mode ===
      'real' &&
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

  if (
    app.mode ===
    'test'
  ) {
    markTestCheck(
      'application_submission'
    );

    markTestCheck(
      'timezone_conversion'
    );
  }

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

  let ownerOverride =
    false;

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
          () => null
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
      seniorCount >=
        2,
  };
}

// =====================================================
// INTERVIEW TEXT CHANNEL
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
          () => null
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
        () => null
      );

  const name =
    member?.user?.username ||
    'applicant';

  const channel =
    await guild.channels.create({
      name:
        `interview-${slugify(
          name
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

      reason:
        `Interview text channel for application ${app.id}`,
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

// =====================================================
// SCORING CHANNEL
// =====================================================

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
          () => null
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
        () => null
      );

  const name =
    member?.user?.username ||
    'applicant';

  const channel =
    await guild.channels.create({
      name:
        `scoring-${slugify(
          name
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        SCORING_CATEGORY_ID,

      permissionOverwrites:
        staffTextPermissions(
          guild
        ),

      reason:
        `Scoring channel for application ${app.id}`,
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
// SCORING HOME CONTROLS
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
          .setEmoji('🎙️')
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
          .setEmoji('🏁')
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
          .setEmoji('➕')
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `open_questions:${appId}`
          )
          .setLabel(
            'Open Interview Questions'
          )
          .setEmoji('📝')
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
          .setEmoji('📊')
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
          .setEmoji('❌')
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

  const interviewers =
    getInterviewers(
      app.id
    );

  await channel.send({
    content:
      interviewers.length
        ? interviewers
            .map(
              id =>
                `<@${id}>`
            )
            .join(' ')
        : `<@&${SENIOR_STAFF_ROLE_ID}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          '🛡️ Trial Moderator Promotion Board'
        )
        .setDescription([
          OPENING_BRIEF,

          '',

          '### Interview Controls',

          '• **Start Interview** and **End Interview** are Owner/Co-Owner only.',

          '• Owner/Co-Owner can add one or more Senior Staff interviewers.',

          '• Every interviewer scores independently.',

          '• Each category receives one score from **0/3 to 3/3**.',

          '• Every category can also have interviewer notes.',

          `• Maximum score per interviewer: **${MAX_SCORE_PER_INTERVIEWER}/${MAX_SCORE_PER_INTERVIEWER}**`,

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

  const scoringChannel =
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

  const interviewers =
    getInterviewers(
      app.id
    );

  await textChannel.send({
    content:
      `<@${app.user_id}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          app.mode ===
            'test'
            ? '🧪 TEST Interview Confirmed'
            : '✅ Staff Interview Confirmed'
        )
        .setDescription([
          `**Interview:** <t:${app.interview_ts}:F>`,

          `**Starts:** <t:${app.interview_ts}:R>`,

          '',

          'Wait for the Owner or Co-Owner to start the interview.',

          'When the interview starts, the voice channel will appear here.',
        ].join('\n')),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `applicant_cancel:${app.id}`
            )
            .setLabel(
              'Cancel Interviewing'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ],
  });

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    const msg =
      await notificationChannel.send({
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
              '✅ Interview Confirmed'
            )
            .setDescription([
              `**Applicant:** <@${app.user_id}>`,

              `**Interview:** <t:${app.interview_ts}:F>`,

              `**Starts:** <t:${app.interview_ts}:R>`,

              '',

              '**Interviewers**',

              interviewers.length
                ? interviewers
                    .map(
                      id =>
                        `<@${id}>`
                    )
                    .join('\n')
                : 'None',

              '',

              `Private scoring room: ${scoringChannel}`,
            ].join('\n')),
        ],
      });

    db.prepare(`
      UPDATE applications
      SET notification_message_id = ?
      WHERE id = ?
    `).run(
      msg.id,
      app.id
    );
  }

  const user =
    await client.users
      .fetch(
        app.user_id
      )
      .catch(
        () => null
      );

  if (
    user
  ) {
    await user.send([
      '✅ **Your Crafted SMP Staff Interview is confirmed.**',

      '',

      `<t:${app.interview_ts}:F>`,

      '',

      'You will be notified when the voice channel opens.',
    ].join('\n'))
      .catch(
        () => null
      );
  }

  if (
    app.mode ===
    'test'
  ) {
    markTestCheck(
      'confirmation'
    );
  }

  await postSubmittedApplication(
    app.id
  );
}

// =====================================================
// CREATE VOICE CHANNEL
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
          () => null
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
        () => null
      );

  const name =
    applicant?.user?.username ||
    'Applicant';

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
        `Interview - ${name}`
          .slice(
            0,
            90
          ),

      type:
        ChannelType.GuildVoice,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        overwrites,

      reason:
        `Interview voice channel for application ${app.id}`,
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

// =====================================================
// QUESTION SESSION
// =====================================================

function getQuestionSession(
  appId,
  staffId
) {
  let session =
    db.prepare(`
      SELECT *
      FROM question_sessions
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
      INSERT INTO question_sessions(
        app_id,
        staff_id,
        current_index,
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

      current_index:
        -1,

      finished:
        0,
    };
  }

  return session;
}

function getCategoryRecord(
  appId,
  staffId,
  categoryIndex
) {
  return db
    .prepare(`
      SELECT *
      FROM category_scores
      WHERE app_id = ?
        AND staff_id = ?
        AND category_index = ?
    `)
    .get(
      appId,
      staffId,
      categoryIndex
    );
}

function getAllCategoryRecords(
  appId,
  staffId
) {
  return db
    .prepare(`
      SELECT *
      FROM category_scores
      WHERE app_id = ?
        AND staff_id = ?
      ORDER BY category_index
    `)
    .all(
      appId,
      staffId
    );
}

function scoreSummary(
  appId,
  staffId
) {
  const rows =
    getAllCategoryRecords(
      appId,
      staffId
    );

  const scored =
    rows.filter(
      row =>
        Number.isInteger(
          row.score
        )
    );

  const total =
    scored.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.score,

      0
    );

  return {
    rows,

    scoredCount:
      scored.length,

    total,
  };
}

// =====================================================
// SCORE MODAL
// =====================================================

function categoryScoreModal(
  appId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const modal =
    new ModalBuilder()
      .setCustomId(
        `category_score_modal:${appId}:${categoryIndex}`
      )
      .setTitle(
        `Score ${category.name
          .replace(
            /^[^A-Za-z0-9]+/,
            ''
          )
          .slice(
            0,
            35
          )}`
      );

  const input =
    new TextInputBuilder()
      .setCustomId(
        'category_score'
      )
      .setLabel(
        'Category score: 0/3, 1/3, 2/3, or 3/3'
      )
      .setPlaceholder(
        'Example: 3/3'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(
        true
      )
      .setMaxLength(
        3
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        input
      )
  );

  return modal;
}

// =====================================================
// NOTES MODAL
// =====================================================

function categoryNotesModal(
  appId,
  categoryIndex,
  currentNotes = ''
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const modal =
    new ModalBuilder()
      .setCustomId(
        `category_notes_modal:${appId}:${categoryIndex}`
      )
      .setTitle(
        `Notes - ${category.name
          .replace(
            /^[^A-Za-z0-9]+/,
            ''
          )
          .slice(
            0,
            35
          )}`
      );

  const input =
    new TextInputBuilder()
      .setCustomId(
        'category_notes'
      )
      .setLabel(
        'Interview notes for this category'
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
    currentNotes
  ) {
    input.setValue(
      currentNotes.slice(
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

// =====================================================
// OPENING / CLOSING / QUESTION EMBEDS
// =====================================================

function openingBriefEmbed(
  app
) {
  return new EmbedBuilder()
    .setTitle(
      '🛡️ Interview Opening Brief'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      OPENING_BRIEF,

      '',

      'Click **Next** to begin Question 1.',
    ].join('\n'));
}

function closingBriefEmbed(
  app
) {
  return new EmbedBuilder()
    .setTitle(
      '🏁 Interview Closing Brief'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      CLOSING_BRIEF,

      '',

      'Review your category scores and notes, then click **Finish My Scoring**.',
    ].join('\n'));
}

function questionEmbed(
  app,
  staffId,
  index
) {
  const item =
    ALL_QUESTIONS[
      index
    ];

  const category =
    QUESTION_CATEGORIES[
      item.categoryIndex
    ];

  const record =
    getCategoryRecord(
      app.id,
      staffId,
      item.categoryIndex
    );

  return new EmbedBuilder()
    .setTitle(
      `📝 Question ${index + 1} of ${ALL_QUESTIONS.length}`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      `### ${category.name}${
        category.code
          ? ` — ${category.code}`
          : ''
      }`,

      '',

      `## ${item.number}. ${item.text}`,

      '',

      `**Category Score:** ${
        Number.isInteger(
          record?.score
        )
          ? `${record.score}/3`
          : 'Not scored yet'
      }`,

      '',

      '**Category Notes:**',

      record?.notes
        ? record.notes.slice(
            0,
            800
          )
        : '_No notes yet._',
    ].join('\n'));
}

// =====================================================
// QUESTION NAVIGATION BUTTONS
// =====================================================

function navRows(
  app,
  staffId,
  index
) {
  const atOpening =
    index === -1;

  const atClosing =
    index ===
    ALL_QUESTIONS.length;

  if (
    atOpening
  ) {
    return [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `question_next:${app.id}`
            )
            .setLabel(
              'Next'
            )
            .setEmoji('➡️')
            .setStyle(
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `cant_make:${app.id}`
            )
            .setLabel(
              'Cancel Interviewing'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ];
  }

  if (
    atClosing
  ) {
    return [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `question_prev:${app.id}`
            )
            .setLabel(
              'Previous'
            )
            .setEmoji('⬅️')
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
            .setEmoji('📊')
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
            .setEmoji('✅')
            .setStyle(
              ButtonStyle.Success
            )
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `cant_make:${app.id}`
            )
            .setLabel(
              'Cancel Interviewing'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ];
  }

  const item =
    ALL_QUESTIONS[
      index
    ];

  const categoryIndex =
    item.categoryIndex;

  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `question_prev:${app.id}`
          )
          .setLabel(
            'Previous'
          )
          .setEmoji('⬅️')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `question_next:${app.id}`
          )
          .setLabel(
            index ===
              ALL_QUESTIONS.length -
                1
              ? 'Closing Brief'
              : 'Next'
          )
          .setEmoji('➡️')
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `score_category:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Type Category Score'
          )
          .setEmoji('⭐')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `notes_category:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Add / Edit Notes'
          )
          .setEmoji('🗒️')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `view_score_progress:${app.id}`
          )
          .setLabel(
            'View Scores'
          )
          .setEmoji('📊')
          .setStyle(
            ButtonStyle.Secondary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `cant_make:${app.id}`
          )
          .setLabel(
            'Cancel Interviewing'
          )
          .setEmoji('❌')
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

// =====================================================
// SCORE PROGRESS
// =====================================================

function scoreProgressEmbed(
  app,
  staffId
) {
  const rows =
    getAllCategoryRecords(
      app.id,
      staffId
    );

  const byIndex =
    new Map(
      rows.map(
        row => [
          row.category_index,
          row,
        ]
      )
    );

  let total = 0;
  let scoredCount = 0;

  const lines =
    QUESTION_CATEGORIES.map(
      (
        category,
        index
      ) => {
        const row =
          byIndex.get(
            index
          );

        if (
          Number.isInteger(
            row?.score
          )
        ) {
          total +=
            row.score;

          scoredCount++;
        }

        return [
          `**${category.name}**`,

          `Score: **${
            Number.isInteger(
              row?.score
            )
              ? `${row.score}/3`
              : 'Not scored'
          }**`,

          `Notes: ${
            row?.notes
              ? row.notes.slice(
                  0,
                  300
                )
              : '_No notes_'
          }`,
        ].join('\n');
      }
    );

  return new EmbedBuilder()
    .setTitle(
      '📊 My Interview Scoring Progress'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      ...lines,

      '',

      `**Categories Scored:** ${scoredCount}/${CATEGORY_COUNT}`,

      `**Current Total:** ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
    ].join('\n'));
}

function allInterviewersFinished(
  appId
) {
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
    id => {
      const row =
        db.prepare(`
          SELECT finished
          FROM question_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `)
          .get(
            appId,
            id
          );

      return (
        row?.finished ===
        1
      );
    }
  );
}

// =====================================================
// START INTERVIEW
// =====================================================

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

  if (
    app.status ===
    'in_progress'
  ) {
    throw new Error(
      'This interview is already in progress.'
    );
  }

  if (
    [
      'completed',
      'accepted',
      'rejected',
      'cancelled',
    ].includes(
      app.status
    )
  ) {
    throw new Error(
      'This interview is already finished.'
    );
  }

  const approvalStatus =
    await getApprovalStatus(
      app.id,
      guild
    );

  if (
    !approvalStatus.confirmed
  ) {
    throw new Error(
      'This interview still needs 2 Senior Staff confirmations or 1 Owner/Co-Owner confirmation.'
    );
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  if (
    !interviewers.length
  ) {
    throw new Error(
      'No interviewers are confirmed.'
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

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    await notificationChannel.send({
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
            '🎙️ Interview Has Started'
          )
          .setDescription([
            `**Applicant:** <@${app.user_id}>`,

            '',

            '### 🔊 Join the voice channel',

            `${voice}`,
          ].join('\n')),
      ],
    });
  }

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
            'Staff is ready for you.',

            '',

            '### 🔊 Click the voice channel below to join',

            `${voice}`,
          ].join('\n')),
      ],

      components: [
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `applicant_cancel:${app.id}`
              )
              .setLabel(
                'Cancel Interviewing'
              )
              .setEmoji('❌')
              .setStyle(
                ButtonStyle.Danger
              )
          ),
      ],
    });
  }

  if (
    app.mode ===
    'test'
  ) {
    markTestCheck(
      'voice'
    );
  }

  await postSubmittedApplication(
    app.id
  );

  return voice;
}

// =====================================================
// PERMANENT RESULTS
// =====================================================

async function postResults(
  appId
) {
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
      'Permanent results channel not found.'
    );
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  let combinedTotal = 0;
  let combinedMax = 0;

  const embeds = [];

  for (
    const staffId
    of interviewers
  ) {
    const records =
      getAllCategoryRecords(
        app.id,
        staffId
      );

    const byIndex =
      new Map(
        records.map(
          row => [
            row.category_index,
            row,
          ]
        )
      );

    let total = 0;

    const sections =
      QUESTION_CATEGORIES.map(
        (
          category,
          index
        ) => {
          const row =
            byIndex.get(
              index
            );

          const score =
            Number.isInteger(
              row?.score
            )
              ? row.score
              : 0;

          total +=
            score;

          return [
            `**${category.name} — ${score}/3**`,

            `Notes: ${
              row?.notes
                ? row.notes.slice(
                    0,
                    800
                  )
                : '_No notes_'
            }`,
          ].join('\n');
        }
      );

    combinedTotal +=
      total;

    combinedMax +=
      MAX_SCORE_PER_INTERVIEWER;

    embeds.push(
      new EmbedBuilder()
        .setTitle(
          `📝 Interviewer Score — ${staffId}`
        )
        .setDescription(
          [
            `**Applicant:** <@${app.user_id}>`,

            `**Interviewer:** <@${staffId}>`,

            '',

            ...sections,

            '',

            `**TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}**`,

            `**${(
              (
                total /
                MAX_SCORE_PER_INTERVIEWER
              ) *
              100
            ).toFixed(
              1
            )}%**`,
          ]
            .join('\n')
            .slice(
              0,
              4000
            )
        )
    );
  }

  const overall =
    combinedMax
      ? (
          (
            combinedTotal /
            combinedMax
          ) *
          100
        ).toFixed(
          1
        )
      : '0.0';

  embeds.unshift(
    new EmbedBuilder()
      .setTitle(
        app.mode ===
          'test'
          ? '🧪 TEST Interview Scores'
          : '📊 Crafted SMP Staff Interview Scores'
      )
      .setDescription([
        `**Applicant:** <@${app.user_id}>`,

        `**Application:** #${app.id}`,

        '',

        `**Combined Score:** ${combinedTotal}/${combinedMax}`,

        `**Overall:** ${overall}%`,

        '',

        '**These scores and notes are staff-only and permanent.**',
      ].join('\n'))
  );

  await channel.send({
    embeds:
      embeds.slice(
        0,
        10
      ),

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `final_accept:${app.id}`
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
              `final_reject:${app.id}`
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
              `final_review:${app.id}`
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

  if (
    app.mode ===
    'test'
  ) {
    markTestCheck(
      'results'
    );
  }
}

// =====================================================
// DELETE ALL TEMPORARY INTERVIEW CHANNELS
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
          () => null
        );

    if (
      channel
    ) {
      await channel
        .delete(
          `Cleaning interview ${app.id}`
        )
        .catch(
          () => null
        );
    }
  }

  await deleteMessageIfPossible(
    INTERVIEW_NOTIFICATION_CHANNEL_ID,
    app.notification_message_id
  );

  db.prepare(`
    UPDATE applications
    SET
      interview_voice_channel_id = NULL,
      scoring_channel_id = NULL,
      interview_text_channel_id = NULL,
      notification_message_id = NULL
    WHERE id = ?
  `).run(
    app.id
  );

  if (
    app.mode ===
    'test'
  ) {
    markTestCheck(
      'cleanup'
    );
  }
}

async function invalidateInterviewBecauseStaffCancelled(
  app,
  guild
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

  await postSubmittedApplication(
    app.id
  );

  const channel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    channel
  ) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '⚠️ Interview Needs New Staff Confirmation'
          )
          .setDescription([
            `**Applicant:** <@${app.user_id}>`,

            '',

            'An interviewer cancelled and there are no longer enough confirmed interviewers.',

            '',

            'All temporary interview channels were deleted to avoid confusion.',
          ].join('\n')),
      ],
    });
  }
}

// =====================================================
// END INTERVIEW
// =====================================================

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
      'This interview is not currently in progress.'
    );
  }

  if (
    !allInterviewersFinished(
      app.id
    )
  ) {
    throw new Error(
      'Every participating interviewer must finish all 7 category scores first.'
    );
  }

  // SAVE RESULTS FIRST
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

  app =
    getApplication(
      app.id
    );

  await postSubmittedApplication(
    app.id
  );

  // THEN DELETE ALL TEMPORARY CHANNELS
  await cleanupInterviewChannels(
    app,
    guild
  );
}

// =====================================================
// TEST RESET
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
      DELETE FROM category_scores
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM question_sessions
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM reminders
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
          () => null
        );

    if (
      channel
    ) {
      await channel
        .delete(
          'Resetting test data'
        )
        .catch(
          () => null
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

  resetTestChecks();
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
          .fetch(
            GUILD_ID
          );

      await guild.members
        .fetchMe();

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
            () => null
          );

      // =================================================
      // MANAGEMENT - TEST MODE
      // =================================================

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

        resetTestChecks();

        await refreshManagementPanel();

        return safeEphemeral(
          interaction,
          '🧪 Testing Mode is enabled. Choose a test applicant next.'
        );
      }

      // =================================================
      // CHOOSE TEST APPLICANT
      // =================================================

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
          ) !==
          'test'
        ) {
          return safeEphemeral(
            interaction,
            'Enable Testing Mode first.'
          );
        }

        const select =
          new UserSelectMenuBuilder()
            .setCustomId(
              'select_test_applicant'
            )
            .setPlaceholder(
              'Choose the test applicant'
            )
            .setMinValues(
              1
            )
            .setMaxValues(
              1
            );

        return interaction.reply({
          content:
            'Choose who should act as the test applicant:',

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
          'select_test_applicant'
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

      // =================================================
      // CHECKLIST
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_checklist'
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

      // =================================================
      // OPEN PUBLIC APPLICATIONS
      // =================================================

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
          `✅ Public applications are open: ${channel}`
        );
      }

      // =================================================
      // CLOSE APPLICATIONS
      // =================================================

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

      // =================================================
      // RESET TEST
      // =================================================

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

      // =================================================
      // APPLY BUTTON
      // =================================================

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
          mode ===
            'test' &&
          getSetting(
            'system_mode'
          ) !==
            'test'
        ) {
          return safeEphemeral(
            interaction,
            'Testing Mode is not enabled.'
          );
        }

        if (
          mode ===
            'real' &&
          getSetting(
            'system_mode'
          ) !==
            'public'
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

      // =================================================
      // APPLICATION MODAL
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'application_modal:'
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

        if (
          mode ===
          'test'
        ) {
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

      // =================================================
      // DATE PAGE
      // =================================================

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
            '❌ This date picker is not yours.'
          );
        }

        return interaction.update(
          buildDatePicker(
            app,
            Number(
              page
            )
          )
        );
      }

      // =================================================
      // PICK DATE
      // =================================================

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
                .split(':')[1]
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

      // =================================================
      // BACK TO DATES
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_dates:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
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
          buildDatePicker(
            app,
            0
          )
        );
      }

      // =================================================
      // PICK TIME
      // =================================================

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

      // =================================================
      // BACK TO TIMES
      // =================================================

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
            .split(':');

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
          buildTimePicker(
            app,
            dateISO
          )
        );
      }

      // =================================================
      // PICK TIMEZONE
      // =================================================

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

        return saveSchedule(
          interaction,
          app,
          dateISO,
          timeValue,
          interaction.values[0]
        );
      }

      // =================================================
      // CONFIRM INTERVIEW
      // =================================================

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
              .split(':')[1]
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

        if (
          app.mode ===
          'test'
        ) {
          markTestCheck(
            'staff_approvals'
          );

          if (
            isOwnerOrCoOwner(
              member
            )
          ) {
            markTestCheck(
              'owner_override'
            );
          }
        }

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
            '✅ Interview confirmed. The private interview and scoring channels are ready.'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ Confirmation recorded. ${approval.seniorCount}/2 Senior Staff confirmations.`
        );
      }

      // =================================================
      // ADD SENIOR STAFF
      // OWNER / CO OWNER ONLY
      // =================================================

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
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        const select =
          new UserSelectMenuBuilder()
            .setCustomId(
              `select_add_senior:${app.id}`
            )
            .setPlaceholder(
              'Choose one or more Senior Staff'
            )
            .setMinValues(
              1
            )
            .setMaxValues(
              10
            );

        return interaction.reply({
          content:
            'Select Senior Staff members to add to this interview:',

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
                () => null
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

        if (
          app.mode ===
            'test' &&
          added.length
        ) {
          markTestCheck(
            'add_senior_staff'
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return interaction.update({
          content: [
            added.length
              ? `✅ Added: ${added
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(', ')}`
              : 'No Senior Staff were added.',

            rejected.length
              ? `\n❌ These selected users do not have the Senior Staff role: ${rejected
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(', ')}`
              : '',
          ].join(''),

          components: [],
        });
      }

      // =================================================
      // INTERVIEWER CANCEL
      // =================================================

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
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            'You are not currently an interviewer for this application.'
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
          DELETE FROM category_scores
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM question_sessions
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

        const remaining =
          getInterviewers(
            app.id
          );

        if (
          !approval.confirmed ||
          remaining.length ===
            0
        ) {
          await invalidateInterviewBecauseStaffCancelled(
            app,
            guild
          );

          return safeEphemeral(
            interaction,
            '✅ You were removed. There are no longer enough confirmed interviewers, so all temporary interview channels were deleted.'
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          '✅ You were removed from this interview. The remaining interviewers can continue.'
        );
      }

      // =================================================
      // RESCHEDULE REQUEST
      // =================================================

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

        await postSubmittedApplication(
          app.id
        );

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(
              () => null
            );

        if (
          user
        ) {
          await user.send({
            content:
              '📅 Staff needs you to choose a different interview date/time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `applicant_reschedule:${app.id}`
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
          })
            .catch(
              () => null
            );
        }

        if (
          app.mode ===
          'test'
        ) {
          markTestCheck(
            'rescheduling'
          );
        }

        return safeEphemeral(
          interaction,
          '📅 Applicant was asked to choose another time.'
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
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            'This button is only for the applicant.'
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

      // =================================================
      // APPLICANT CANCEL
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'applicant_cancel:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Only the applicant can use this button.'
          );
        }

        return interaction.reply({
          content:
            '⚠️ Cancel your staff interview?',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_applicant_cancel:${app.id}`
                  )
                  .setLabel(
                    'Yes — Cancel Interview'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `keep_applicant_interview:${app.id}`
                  )
                  .setLabel(
                    'Keep Interview'
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
          'keep_applicant_interview:'
        )
      ) {
        return interaction.update({
          content:
            '✅ Your interview is still scheduled.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_applicant_cancel:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Only the applicant can cancel this interview.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'cancelled'
          WHERE id = ?
        `).run(
          app.id
        );

        await cleanupInterviewChannels(
          app,
          guild
        );

        await postSubmittedApplication(
          app.id
        );

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
                  '❌ Interview Cancelled by Applicant'
                )
                .setDescription(
                  `<@${app.user_id}> cancelled their staff interview.`
                ),
            ],
          });
        }

        return interaction.update({
          content:
            '❌ Your staff interview has been cancelled.',

          components: [],
        });
      }

      // =================================================
      // TEST START NOW
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'test_start_now:'
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
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (
          !app ||
          app.mode !==
            'test'
        ) {
          return safeEphemeral(
            interaction,
            '❌ Test applications only.'
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

        // Important:
        // keep status pending first so confirmInterview creates channels
        db.prepare(`
          UPDATE applications
          SET
            interview_ts = ?,
            timezone = 'TEST-NOW',
            status = 'pending'
          WHERE id = ?
        `).run(
          unixNow(),
          app.id
        );

        await confirmInterview(
          app.id,
          guild
        );

        await startInterview(
          app.id,
          guild
        );

        return safeEphemeral(
          interaction,
          '⚡ Test interview started immediately.'
        );
      }

      // =================================================
      // START INTERVIEW
      // OWNER / CO OWNER
      // SCORING CHANNEL ONLY
      // =================================================

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
              .split(':')[1]
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
            '❌ Start Interview can only be used inside the scoring channel.'
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

      // =================================================
      // OPEN INTERVIEW QUESTIONS
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'open_questions:'
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
          getQuestionSession(
            app.id,
            interaction.user.id
          );

        const index =
          Math.max(
            -1,
            Math.min(
              ALL_QUESTIONS.length,
              session.current_index
            )
          );

        if (
          app.mode ===
          'test'
        ) {
          markTestCheck(
            'questions'
          );
        }

        if (
          index ===
          -1
        ) {
          return interaction.reply({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components:
              navRows(
                app,
                interaction.user.id,
                index
              ),

            flags:
              MessageFlags.Ephemeral,
          });
        }

        if (
          index ===
          ALL_QUESTIONS.length
        ) {
          return interaction.reply({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              navRows(
                app,
                interaction.user.id,
                index
              ),

            flags:
              MessageFlags.Ephemeral,
          });
        }

        return interaction.reply({
          embeds: [
            questionEmbed(
              app,
              interaction.user.id,
              index
            ),
          ],

          components:
            navRows(
              app,
              interaction.user.id,
              index
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // PREVIOUS / NEXT QUESTIONS
      // =================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'question_prev:'
          ) ||
          interaction.customId.startsWith(
            'question_next:'
          )
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
          getQuestionSession(
            app.id,
            interaction.user.id
          );

        const delta =
          interaction.customId.startsWith(
            'question_next:'
          )
            ? 1
            : -1;

        const nextIndex =
          Math.max(
            -1,
            Math.min(
              ALL_QUESTIONS.length,
              session.current_index +
                delta
            )
          );

        db.prepare(`
          UPDATE question_sessions
          SET current_index = ?
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          nextIndex,
          app.id,
          interaction.user.id
        );

        if (
          nextIndex ===
            ALL_QUESTIONS.length &&
          app.mode ===
            'test'
        ) {
          markTestCheck(
            'closing_brief'
          );
        }

        if (
          nextIndex ===
          -1
        ) {
          return interaction.update({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components:
              navRows(
                app,
                interaction.user.id,
                nextIndex
              ),
          });
        }

        if (
          nextIndex ===
          ALL_QUESTIONS.length
        ) {
          return interaction.update({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              navRows(
                app,
                interaction.user.id,
                nextIndex
              ),
          });
        }

        return interaction.update({
          embeds: [
            questionEmbed(
              app,
              interaction.user.id,
              nextIndex
            ),
          ],

          components:
            navRows(
              app,
              interaction.user.id,
              nextIndex
            ),
        });
      }

      // =================================================
      // SCORE CATEGORY
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'score_category:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(
              appIdRaw
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

        return interaction.showModal(
          categoryScoreModal(
            app.id,
            Number(
              categoryIndexRaw
            )
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'category_score_modal:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(':');

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

        const raw =
          interaction.fields
            .getTextInputValue(
              'category_score'
            )
            .trim();

        const match =
          raw.match(
            /^([0-3])(?:\s*\/\s*3)?$/
          );

        if (
          !match
        ) {
          return safeEphemeral(
            interaction,
            '❌ Enter 0/3, 1/3, 2/3, or 3/3.'
          );
        }

        const score =
          Number(
            match[1]
          );

        const existing =
          getCategoryRecord(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        db.prepare(`
          INSERT INTO category_scores(
            app_id,
            staff_id,
            category_index,
            score,
            notes
          )
          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?
          )

          ON CONFLICT(
            app_id,
            staff_id,
            category_index
          )

          DO UPDATE SET
            score =
              excluded.score
        `).run(
          app.id,
          interaction.user.id,
          categoryIndex,
          score,
          existing?.notes ||
            ''
        );

        if (
          app.mode ===
          'test'
        ) {
          markTestCheck(
            'category_scoring'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ ${QUESTION_CATEGORIES[categoryIndex].name} saved as **${score}/3**.`
        );
      }

      // =================================================
      // CATEGORY NOTES
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'notes_category:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryIndexRaw,
        ] =
          interaction.customId
            .split(':');

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

        const current =
          getCategoryRecord(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        return interaction.showModal(
          categoryNotesModal(
            app.id,
            categoryIndex,
            current?.notes ||
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
            .split(':');

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

        const notes =
          interaction.fields
            .getTextInputValue(
              'category_notes'
            )
            .trim();

        const current =
          getCategoryRecord(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        db.prepare(`
          INSERT INTO category_scores(
            app_id,
            staff_id,
            category_index,
            score,
            notes
          )
          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?
          )

          ON CONFLICT(
            app_id,
            staff_id,
            category_index
          )

          DO UPDATE SET
            notes =
              excluded.notes
        `).run(
          app.id,
          interaction.user.id,
          categoryIndex,
          current?.score ??
            null,
          notes
        );

        if (
          app.mode ===
          'test'
        ) {
          markTestCheck(
            'category_notes'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ Notes saved for ${QUESTION_CATEGORIES[categoryIndex].name}.`
        );
      }

      // =================================================
      // VIEW SCORE PROGRESS
      // =================================================

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
                .split(':')[1]
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

      // =================================================
      // FINISH INTERVIEWER SCORING
      // =================================================

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
                .split(':')[1]
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
          getQuestionSession(
            app.id,
            interaction.user.id
          );

        if (
          session.current_index !==
          ALL_QUESTIONS.length
        ) {
          return safeEphemeral(
            interaction,
            '❌ Go through all questions and reach the Closing Brief before finishing your scoring.'
          );
        }

        const summary =
          scoreSummary(
            app.id,
            interaction.user.id
          );

        if (
          summary.scoredCount !==
          CATEGORY_COUNT
        ) {
          return safeEphemeral(
            interaction,
            `❌ You have scored **${summary.scoredCount}/${CATEGORY_COUNT}** categories. Score all 7 categories first.`
          );
        }

        db.prepare(`
          UPDATE question_sessions
          SET finished = 1
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        return safeEphemeral(
          interaction,
          `✅ Your scoring is finished. Final score: **${summary.total}/${MAX_SCORE_PER_INTERVIEWER}**.`
        );
      }

      // =================================================
      // END INTERVIEW
      // OWNER / CO OWNER
      // SCORING CHANNEL ONLY
      // =================================================

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
            '❌ Only Owner or Co-Owner can end the interview.'
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
            '❌ End Interview can only be used inside the scoring channel.'
          );
        }

        if (
          !allInterviewersFinished(
            app.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Every participating interviewer must finish all 7 category scores first.'
          );
        }

        return interaction.reply({
          content: [
            '🏁 **End this interview?**',

            '',

            `✅ Permanent scores and notes will be saved in <#${INTERVIEW_RESULTS_CHANNEL_ID}>.`,

            '',

            '🗑️ Then ALL temporary interview channels will be deleted:',

            '• Applicant interview text channel',

            '• Scoring channel',

            '• Interview voice channel',
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
              .split(':')[1]
          );

        await interaction.deferUpdate();

        try {
          await endInterview(
            appId,
            guild
          );

          return interaction.editReply({
            content:
              '✅ Interview ended. Scores were saved permanently and all temporary interview channels were deleted.',

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

      // =================================================
      // FINAL RESULT
      // STAFF ONLY
      // APPLICANT NOT NOTIFIED
      // =================================================

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
            .split(':');

        const app =
          getApplication(
            Number(
              appIdRaw
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

        const action =
          actionPart.replace(
            'final_',
            ''
          );

        const status =
          action ===
            'accept'
            ? 'accepted'
            : action ===
                'reject'
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

        // Applicant intentionally receives NO result message.

        return safeEphemeral(
          interaction,
          `✅ Application marked as **${statusLabel(status)}**. The applicant was not shown the result.`
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

// =====================================================
// LOGIN
// =====================================================

client.login(
  DISCORD_TOKEN
);
