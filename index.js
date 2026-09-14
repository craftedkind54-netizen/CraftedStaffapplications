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
  console.error('❌ Missing DISCORD_TOKEN');
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
  category_notes TEXT NOT NULL DEFAULT '',
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

  if (!columns.some(c => c.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

ensureColumn(
  'applications',
  'submission_message_id',
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
  'applications',
  'scoring_channel_id',
  'TEXT'
);

ensureColumn(
  'applications',
  'notification_message_id',
  'TEXT'
);

ensureColumn(
  'applications',
  'completed_at',
  'INTEGER'
);

ensureColumn(
  'interviewers',
  'added_by',
  'TEXT'
);

// =====================================================
// INTERVIEW BRIEFS
// =====================================================

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

// =====================================================
// QUESTIONS
//
// STAFF PICKS EXACTLY 3 QUESTIONS PER CATEGORY.
// EACH SELECTED QUESTION = 1 POINT MAX.
//
// 7 categories × 3 points = 21 points maximum.
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

const CATEGORY_COUNT =
  QUESTION_CATEGORIES.length;

const QUESTIONS_PER_CATEGORY =
  3;

const MAX_SCORE_PER_INTERVIEWER =
  CATEGORY_COUNT *
  QUESTIONS_PER_CATEGORY;

// =====================================================
// DATE / TIME
// =====================================================

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

const TZ = {
  HST: 'Pacific/Honolulu',
  PACIFIC: 'America/Los_Angeles',
  MOUNTAIN: 'America/Denver',
  CENTRAL: 'America/Chicago',
  EASTERN: 'America/New_York',
};

// =====================================================
// HELPERS
// =====================================================

function getSetting(
  key,
  fallback = null
) {
  return db
    .prepare(
      'SELECT value FROM settings WHERE key = ?'
    )
    .get(key)?.value ??
    fallback;
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

function getApplication(
  id
) {
  return db
    .prepare(
      'SELECT * FROM applications WHERE id = ?'
    )
    .get(id);
}

function getApprovals(
  id
) {
  return db
    .prepare(`
      SELECT staff_id
      FROM approvals
      WHERE app_id = ?
      ORDER BY created_at
    `)
    .all(id)
    .map(
      row =>
        row.staff_id
    );
}

function getInterviewers(
  id
) {
  return db
    .prepare(`
      SELECT staff_id
      FROM interviewers
      WHERE app_id = ?
    `)
    .all(id)
    .map(
      row =>
        row.staff_id
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

function isOwnerOrCoOwner(
  member
) {
  return (
    hasRole(
      member,
      OWNER_ROLE_ID
    ) ||
    hasRole(
      member,
      CO_OWNER_ROLE_ID
    )
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

function isAuthorizedStaff(
  member
) {
  return (
    isOwnerOrCoOwner(
      member
    ) ||
    isSenior(
      member
    )
  );
}

function slugify(
  text
) {
  return (
    text ||
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

function statusLabel(
  status
) {
  return {
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
  }[status] ||
  status;
}

async function fetchTextChannel(
  id
) {
  if (!id) {
    return null;
  }

  const channel =
    await client.channels
      .fetch(id)
      .catch(
        () =>
          null
      );

  return channel?.isTextBased()
    ? channel
    : null;
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

function staffPermissions(
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

  if (
    applicantId
  ) {
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

  return new EmbedBuilder()
    .setTitle(
      '🛡️ Crafted SMP Staff Applications'
    )
    .setDescription([
      `**Status:** ${
        mode === 'public'
          ? '🟢 Applications Open'
          : '🔴 Applications Closed'
      }`,

      '',

      `Applications are reviewed in <#${SUBMITTED_APPLICATIONS_CHANNEL_ID}>.`,

      '',

      '**Important:**',

      '🎙️ Start Interview does NOT appear in Submitted Applications.',

      '🏁 End Interview does NOT appear in Submitted Applications.',

      '',

      `Both controls exist only inside the private scoring category <#${SCORING_CATEGORY_ID}>.`,
    ].join('\n'));
}

function managementRows() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'open_apps'
          )
          .setLabel(
            'Open Applications'
          )
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

  if (
    !channel
  ) {
    throw new Error(
      'Control channel not found.'
    );
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 25,
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
                'open_apps'
            )
        )
    );

  if (
    existing
  ) {
    return existing.edit({
      embeds: [
        managementEmbed(),
      ],

      components:
        managementRows(),
    });
  }

  return channel.send({
    embeds: [
      managementEmbed(),
    ],

    components:
      managementRows(),
  });
}

// =====================================================
// PUBLIC APPLICATION PANEL
// =====================================================

function applicationPanelEmbed() {
  return new EmbedBuilder()
    .setTitle(
      '🛡️ Crafted SMP Staff Applications'
    )
    .setDescription([
      'Click **Apply for Staff** to submit your application.',

      '',

      'After applying you will choose:',

      '📅 Date',

      '🕐 Time',

      '🌎 Time zone',
    ].join('\n'));
}

async function createPublicApplicationChannel(
  guild
) {
  const currentId =
    getSetting(
      'public_application_channel_id'
    );

  if (
    currentId
  ) {
    const current =
      await guild.channels
        .fetch(
          currentId
        )
        .catch(
          () =>
            null
        );

    if (
      current
    ) {
      return current;
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
      applicationPanelEmbed(),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'apply_public'
            )
            .setLabel(
              'Apply for Staff'
            )
            .setEmoji(
              '🛡️'
            )
            .setStyle(
              ButtonStyle.Primary
            )
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
  const id =
    getSetting(
      'public_application_channel_id'
    );

  if (
    !id
  ) {
    return;
  }

  const channel =
    await guild.channels
      .fetch(
        id
      )
      .catch(
        () =>
          null
      );

  if (
    channel
  ) {
    await channel
      .delete()
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

function applicationModal() {
  const modal =
    new ModalBuilder()
      .setCustomId(
        'application_modal'
      )
      .setTitle(
        'Staff Application'
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
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
          )
      ),

    new ActionRowBuilder()
      .addComponents(
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
          )
      )
  );

  return modal;
}

// =====================================================
// DATE PICKER
// =====================================================

function datePicker(
  app,
  page = 0
) {
  page =
    Math.max(
      0,
      Math.min(
        11,
        page
      )
    );

  const start =
    DateTime.now()
      .setZone(
        'Pacific/Honolulu'
      )
      .startOf(
        'day'
      )
      .plus({
        days:
          7 +
          page *
            14,
      });

  const options =
    Array.from(
      {
        length:
          14,
      },

      (
        _,
        index
      ) => {
        const date =
          start.plus({
            days:
              index,
          });

        return {
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
        };
      }
    );

  return {
    content:
      '📅 **Choose Interview Date**',

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_date:${app.id}:${page}`
            )
            .setPlaceholder(
              'Choose a date'
            )
            .addOptions(
              options
            )
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
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(
              page === 11
            )
        ),
    ],
  };
}

function timePicker(
  app,
  date
) {
  return {
    content: [
      `📅 **${DateTime.fromISO(
        date
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**`,

      '',

      '🕐 Choose a time',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_time:${app.id}:${date}`
            )
            .setPlaceholder(
              'Choose a time'
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
            )
        ),
    ],
  };
}

function timezonePicker(
  app,
  date,
  time
) {
  return {
    content:
      '🌎 **Choose your time zone**',

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_timezone:${app.id}:${date}:${time}`
            )
            .setPlaceholder(
              'Choose time zone'
            )
            .addOptions(
              {
                label:
                  'HST — Hawaii',

                value:
                  'HST',
              },

              {
                label:
                  'Pacific',

                value:
                  'PACIFIC',
              },

              {
                label:
                  'Mountain',

                value:
                  'MOUNTAIN',
              },

              {
                label:
                  'Central',

                value:
                  'CENTRAL',
              },

              {
                label:
                  'Eastern',

                value:
                  'EASTERN',
              }
            )
        ),
    ],
  };
}

// =====================================================
// SUBMITTED APPLICATION
//
// IMPORTANT:
// THERE IS NO START INTERVIEW BUTTON HERE.
// THERE IS NO END INTERVIEW BUTTON HERE.
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
      app.id
    );

  const interviewers =
    getInterviewers(
      app.id
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        '🛡️ Staff Application'
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
            app.interview_ts
              ? `<t:${app.interview_ts}:F>\n<t:${app.interview_ts}:R>`
              : 'Not selected',

          inline:
            false,
        },

        {
          name:
            'Experience',

          value:
            app.experience.slice(
              0,
              1024
            ),
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
                  .join(
                    '\n'
                  )
              : 'None',

          inline:
            true,
        }
      )
      .setFooter({
        text:
          `Application #${app.id}`,
      });

  const components =
    [];

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
    components.push(
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
              `reschedule:${app.id}`
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
              ButtonStyle.Danger
            )
        )
    );
  }

  let message =
    null;

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

      components,
    });
  } else {
    message =
      await channel.send({
        embeds: [
          embed,
        ],

        components,
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
// APPROVAL RULE
// =====================================================

async function approvalStatus(
  appId,
  guild
) {
  let seniorCount =
    0;

  let ownerOverride =
    false;

  for (
    const id
    of getApprovals(
      appId
    )
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
    seniorCount,
    ownerOverride,

    confirmed:
      ownerOverride ||
      seniorCount >=
        2,
  };
}

// =====================================================
// CREATE INTERVIEW TEXT CHANNEL
// =====================================================

async function ensureInterviewTextChannel(
  app,
  guild
) {
  if (
    app.interview_text_channel_id
  ) {
    const current =
      await guild.channels
        .fetch(
          app.interview_text_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      current
    ) {
      return current;
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
        staffPermissions(
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

// =====================================================
// CREATE SCORING CHANNEL
// =====================================================

async function ensureScoringChannel(
  app,
  guild
) {
  if (
    app.scoring_channel_id
  ) {
    const current =
      await guild.channels
        .fetch(
          app.scoring_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      current
    ) {
      return current;
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
        staffPermissions(
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
// START + END INTERVIEW ONLY APPEAR HERE.
// =====================================================

function scoringHomeRows(
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
            `add_senior:${appId}`
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
            `open_board:${appId}`
          )
          .setLabel(
            'Open Interview Questions'
          )
          .setEmoji(
            '📝'
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `view_progress:${appId}`
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

          '• Every category displays all available questions.',

          '• Each interviewer selects exactly **3 questions** from that category.',

          '• Each selected question is worth **1 point**.',

          '• Give the answer either **0/1** or **1/1**.',

          '• Every selected question has its own notes.',

          '• Every category also has overall category notes.',

          '• Each category is worth **3 points maximum**.',

          `• Maximum total score per interviewer is **${MAX_SCORE_PER_INTERVIEWER} points**.`,

          '',

          '**Every interviewer scores independently.**',

          '',

          '**The applicant cannot see this scoring channel.**',
        ].join('\n')),
    ],

    components:
      scoringHomeRows(
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

  const interviewText =
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

  await interviewText.send({
    content:
      `<@${app.user_id}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          '✅ Interview Confirmed'
        )
        .setDescription([
          `**Interview:** <t:${app.interview_ts}:F>`,

          '',

          'Wait for the Owner or Co-Owner to start the interview.',

          '',

          'When the interview starts, the private voice channel will be posted here.',
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

  const permissionOverwrites = [
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
    of getInterviewers(
      app.id
    )
  ) {
    permissionOverwrites.push({
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
        `Interview - ${
          applicant?.user?.username ||
          'Applicant'
        }`,

      type:
        ChannelType.GuildVoice,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites,
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
    await approvalStatus(
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
            '🎙️ Interview Started'
          )
          .setDescription([
            'Staff is ready.',

            '',

            `### Join voice: ${voice}`,
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
// INTERVIEW SCORING DATA
// =====================================================

function getSession(
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

function getProgress(
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
        category_notes
      )
      VALUES(
        ?,
        ?,
        ?,
        '[]',
        ''
      )
    `).run(
      appId,
      staffId,
      categoryIndex
    );

    progress = {
      selected_questions:
        '[]',

      category_notes:
        '',
    };
  }

  return progress;
}

function selectedQuestions(
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
  return db
    .prepare(`
      SELECT *
      FROM question_scores
      WHERE app_id = ?
        AND staff_id = ?
        AND category_index = ?
        AND question_number = ?
    `)
    .get(
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
  const selected =
    selectedQuestions(
      getProgress(
        appId,
        staffId,
        categoryIndex
      )
    );

  let total =
    0;

  let graded =
    0;

  for (
    const questionNumber
    of selected
  ) {
    const score =
      getQuestionScore(
        appId,
        staffId,
        categoryIndex,
        questionNumber
      );

    if (
      Number.isInteger(
        score?.point
      )
    ) {
      total +=
        score.point;

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
  let total =
    0;

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

  return total;
}

// =====================================================
// BRIEF EMBEDS
// =====================================================

function openingEmbed(
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

      'Click **Next Category** when ready.',
    ].join('\n'));
}

function closingEmbed(
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

      'Review your scores and notes.',

      'Then click **Finish My Scoring**.',
    ].join('\n'));
}

// =====================================================
// CATEGORY PAGE
// =====================================================

function categoryEmbed(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestions(
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
          const selectedIcon =
            selected.includes(
              question.number
            )
              ? '✅'
              : '⬜';

          return [
            `${selectedIcon} **${question.number}.** ${question.text}`,
          ].join('');
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

      'Every selected question is worth **1 point**.',

      '',

      questions,

      '',

      `**Selected Questions:** ${selected.length}/3`,

      `**Questions Graded:** ${score.graded}/3`,

      `**Category Score:** ${score.total}/3`,

      '',

      '**Category Notes:**',

      progress.category_notes ||
        '_No category notes yet._',
    ].join('\n'));
}

function categoryRows(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestions(
      progress
    );

  const questionPicker =
    new StringSelectMenuBuilder()
      .setCustomId(
        `pick_questions:${app.id}:${categoryIndex}`
      )
      .setPlaceholder(
        'Choose exactly 3 questions'
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
        questionPicker
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `begin_selected:${app.id}:${categoryIndex}`
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
            `cat_prev:${app.id}`
          )
          .setLabel(
            'Previous Category'
          )
          .setEmoji(
            '⬅️'
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            categoryIndex ===
              0
          ),

        new ButtonBuilder()
          .setCustomId(
            `cat_next:${app.id}`
          )
          .setLabel(
            categoryIndex ===
              CATEGORY_COUNT -
                1
              ? 'Closing Brief'
              : 'Next Category'
          )
          .setEmoji(
            '➡️'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

// =====================================================
// SELECTED QUESTION PAGE
// =====================================================

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

  const selected =
    selectedQuestions(
      getProgress(
        app.id,
        staffId,
        categoryIndex
      )
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

  const score =
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
          score?.point
        )
          ? `${score.point}/1`
          : 'Not graded yet'
      }`,

      '',

      '**Question Notes:**',

      score?.notes ||
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
            `q_zero:${app.id}:${categoryIndex}:${pickIndex}`
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
            `q_one:${app.id}:${categoryIndex}:${pickIndex}`
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
            `q_note:${app.id}:${categoryIndex}:${pickIndex}`
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
            `q_prev:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            'Previous'
          )
          .setEmoji(
            '⬅️'
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            pickIndex ===
              0
          ),

        new ButtonBuilder()
          .setCustomId(
            `q_next:${app.id}:${categoryIndex}:${pickIndex}`
          )
          .setLabel(
            pickIndex ===
              2
              ? 'Back to Category'
              : 'Next'
          )
          .setEmoji(
            '➡️'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

// =====================================================
// NOTES MODAL
// =====================================================

function notesModal(
  customId,
  title,
  current = ''
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        customId
      )
      .setTitle(
        title.slice(
          0,
          45
        )
      );

  const notes =
    new TextInputBuilder()
      .setCustomId(
        'notes'
      )
      .setLabel(
        'Notes'
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
    notes.setValue(
      current.slice(
        0,
        1500
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        notes
      )
  );

  return modal;
}

// =====================================================
// SCORE PROGRESS
// =====================================================

function scoreProgressEmbed(
  app,
  staffId
) {
  const lines =
    [];

  let total =
    0;

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
      `**${QUESTION_CATEGORIES[i].name}: ${score.total}/3** — ${score.graded}/3 questions graded`
    );
  }

  return new EmbedBuilder()
    .setTitle(
      '📊 My Score Progress'
    )
    .setDescription([
      ...lines,

      '',

      `## TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
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
    staffId => {
      const session =
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

      return session?.finished ===
        1;
    }
  );
}

// =====================================================
// RESULTS
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
      'Results channel not found.'
    );
  }

  let combinedTotal =
    0;

  let combinedMaximum =
    0;

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '📊 Crafted SMP Staff Interview Results'
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,

          `**Application:** #${app.id}`,

          '',

          'Individual interviewer reports are posted below.',

          '',

          '**The applicant does not receive these scores.**',
        ].join('\n')),
    ],
  });

  for (
    const staffId
    of getInterviewers(
      app.id
    )
  ) {
    let interviewerTotal =
      0;

    const fields =
      [];

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
        getProgress(
          app.id,
          staffId,
          i
        );

      const selected =
        selectedQuestions(
          progress
        );

      const categoryResult =
        categoryScore(
          app.id,
          staffId,
          i
        );

      interviewerTotal +=
        categoryResult.total;

      const questionLines =
        selected.map(
          questionNumber => {
            const score =
              getQuestionScore(
                app.id,
                staffId,
                i,
                questionNumber
              );

            return [
              `Q${questionNumber}: **${
                Number.isInteger(
                  score?.point
                )
                  ? score.point
                  : 0
              }/1**`,

              score?.notes
                ? `Notes: ${score.notes}`
                : 'Notes: None',
            ].join(
              '\n'
            );
          }
        )
        .join(
          '\n\n'
        );

      fields.push({
        name:
          `${category.name} — ${categoryResult.total}/3`,

        value:
          [
            questionLines ||
              'No questions selected',

            '',

            `**Category Notes:** ${
              progress.category_notes ||
              'None'
            }`,
          ]
            .join(
              '\n'
            )
            .slice(
              0,
              1024
            ),
      });
    }

    combinedTotal +=
      interviewerTotal;

    combinedMaximum +=
      MAX_SCORE_PER_INTERVIEWER;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '📝 Interviewer Score'
          )
          .setDescription([
            `**Applicant:** <@${app.user_id}>`,

            `**Interviewer:** <@${staffId}>`,

            '',

            `## TOTAL: ${interviewerTotal}/${MAX_SCORE_PER_INTERVIEWER}`,
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
          `**Applicant:** <@${app.user_id}>`,

          '',

          `## ${combinedTotal}/${combinedMaximum}`,
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
            .setEmoji(
              '🟡'
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

async function cleanupInterview(
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
        .delete()
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

  // SAVE EVERYTHING FIRST.
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

  // THEN DELETE EVERY TEMPORARY CHANNEL.
  await cleanupInterview(
    app,
    guild
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
        'Startup error:',
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
        await client.guilds.fetch(
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

      // =================================================
      // OPEN APPLICATIONS
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'open_apps'
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

        await ensureManagementPanel();

        return safeEphemeral(
          interaction,
          `✅ Applications opened: ${channel}`
        );
      }

      // =================================================
      // CLOSE APPLICATIONS
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'close_apps'
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

        await deletePublicApplicationChannel(
          guild
        );

        setSetting(
          'system_mode',
          'closed'
        );

        await ensureManagementPanel();

        return safeEphemeral(
          interaction,
          '🔴 Applications closed.'
        );
      }

      // =================================================
      // APPLY
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'apply_public'
      ) {
        if (
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
          db.prepare(`
            SELECT id
            FROM applications
            WHERE user_id = ?
              AND status NOT IN (
                'completed',
                'accepted',
                'rejected',
                'cancelled'
              )
            ORDER BY id DESC
            LIMIT 1
          `)
            .get(
              interaction.user.id
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
          applicationModal()
        );
      }

      // =================================================
      // APPLICATION FORM
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'application_modal'
      ) {
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
              'real',
              ?,
              ?,
              0,
              'PENDING',
              'choosing_time',
              ?
            )
          `).run(
            interaction.user.id,
            age,
            experience,
            Date.now()
          );

        const app =
          getApplication(
            result.lastInsertRowid
          );

        return interaction.reply({
          ...datePicker(
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
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          datePicker(
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
        const [
          ,
          appId,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          timePicker(
            app,
            interaction.values[0]
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
          date,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          timezonePicker(
            app,
            date,
            interaction.values[0]
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
          date,
          time,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        const timezone =
          interaction.values[0];

        const zone =
          TZ[
            timezone
          ];

        const dateTime =
          DateTime.fromISO(
            `${date}T${time}:00`,
            {
              zone,
            }
          );

        if (
          !dateTime.isValid
        ) {
          return safeEphemeral(
            interaction,
            '❌ Invalid date/time.'
          );
        }

        const timestamp =
          Math.floor(
            dateTime.toSeconds()
          );

        if (
          timestamp <
          Math.floor(
            Date.now() /
              1000
          ) +
            7 *
              86400
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviews must be at least 7 days in advance.'
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
          timezone,
          app.id
        );

        await postSubmittedApplication(
          app.id
        );

        return interaction.update({
          content:
            `✅ Interview time selected: <t:${timestamp}:F>`,

          components: [],
        });
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
          await approvalStatus(
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
            '✅ Interview confirmed. The applicant interview channel and private scoring channel were created.'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ Confirmation recorded. ${approval.seniorCount}/2 Senior Staff confirmations.`
        );
      }

      // =================================================
      // RESCHEDULE
      // =================================================

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
              '📅 Staff needs you to choose a different interview time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `app_reschedule:${app.id}`
                    )
                    .setLabel(
                      'Choose New Date & Time'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          })
            .catch(
              () =>
                null
            );
        }

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          '📅 Reschedule request sent.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'app_reschedule:'
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
            '❌ Applicant only.'
          );
        }

        return interaction.reply({
          ...datePicker(
            app,
            0
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // ADD SENIOR STAFF
      // ONLY FROM SCORING CHANNEL
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'add_senior:'
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
            '❌ Add Senior Staff only works inside the private scoring channel.'
          );
        }

        return interaction.reply({
          content:
            'Choose one or more Senior Staff to participate:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    `select_senior:${app.id}`
                  )
                  .setMinValues(
                    1
                  )
                  .setMaxValues(
                    10
                  )
                  .setPlaceholder(
                    'Choose Senior Staff'
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
          'select_senior:'
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

        const added =
          [];

        const rejected =
          [];

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
              ? `✅ Added: ${added
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(
                    ', '
                  )}`
              : 'No Senior Staff were added.',

            rejected.length
              ? `\n❌ These users do not have Senior Staff: ${rejected
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(
                    ', '
                  )}`
              : '',
          ].join(''),

          components: [],
        });
      }

      // =================================================
      // STAFF CANCEL PARTICIPATION
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
          await approvalStatus(
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
          await cleanupInterview(
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
          '✅ You were removed from the interview.'
        );
      }

      // =================================================
      // START INTERVIEW
      //
      // OWNER / CO OWNER ONLY.
      // SCORING CHANNEL ONLY.
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
              app.id,
              guild
            );

          return interaction.editReply(
            `🎙️ Interview started: ${voice}`
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
          'open_board:'
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
          interaction.channelId !==
            app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interview questions only work inside the scoring channel.'
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
          getSession(
            app.id,
            interaction.user.id
          );

        if (
          session.current_category ===
          -1
        ) {
          return interaction.reply({
            embeds: [
              openingEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_next:${app.id}`
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
          session.current_category >=
          CATEGORY_COUNT
        ) {
          return interaction.reply({
            embeds: [
              closingEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_prev:${app.id}`
                    )
                    .setLabel(
                      'Previous Category'
                    )
                    .setStyle(
                      ButtonStyle.Secondary
                    ),

                  new ButtonBuilder()
                    .setCustomId(
                      `view_progress:${app.id}`
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
            ],

            flags:
              MessageFlags.Ephemeral,
          });
        }

        return interaction.reply({
          embeds: [
            categoryEmbed(
              app,
              interaction.user.id,
              session.current_category
            ),
          ],

          components:
            categoryRows(
              app,
              interaction.user.id,
              session.current_category
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // PREVIOUS / NEXT CATEGORY
      // =================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'cat_prev:'
          ) ||
          interaction.customId.startsWith(
            'cat_next:'
          )
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
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ You are not an interviewer.'
          );
        }

        const session =
          getSession(
            app.id,
            interaction.user.id
          );

        const movingForward =
          interaction.customId.startsWith(
            'cat_next:'
          );

        const delta =
          movingForward
            ? 1
            : -1;

        if (
          movingForward &&
          session.current_category >=
            0 &&
          session.current_category <
            CATEGORY_COUNT
        ) {
          const progress =
            getProgress(
              app.id,
              interaction.user.id,
              session.current_category
            );

          const selected =
            selectedQuestions(
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
            3
          ) {
            return safeEphemeral(
              interaction,
              '❌ Pick exactly 3 questions before moving to the next category.'
            );
          }

          if (
            score.graded !==
            3
          ) {
            return safeEphemeral(
              interaction,
              '❌ Grade all 3 selected questions before moving to the next category.'
            );
          }
        }

        const nextCategory =
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
          nextCategory,
          app.id,
          interaction.user.id
        );

        if (
          nextCategory ===
          -1
        ) {
          return interaction.update({
            embeds: [
              openingEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_next:${app.id}`
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
          nextCategory >=
          CATEGORY_COUNT
        ) {
          return interaction.update({
            embeds: [
              closingEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_prev:${app.id}`
                    )
                    .setLabel(
                      'Previous Category'
                    )
                    .setStyle(
                      ButtonStyle.Secondary
                    ),

                  new ButtonBuilder()
                    .setCustomId(
                      `view_progress:${app.id}`
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
                    .setStyle(
                      ButtonStyle.Success
                    )
                ),
            ],
          });
        }

        return interaction.update({
          embeds: [
            categoryEmbed(
              app,
              interaction.user.id,
              nextCategory
            ),
          ],

          components:
            categoryRows(
              app,
              interaction.user.id,
              nextCategory
            ),
        });
      }

      // =================================================
      // SELECT EXACTLY 3 QUESTIONS
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_questions:'
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app ||
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

        const selected =
          interaction.values.map(
            Number
          );

        if (
          selected.length !==
          3
        ) {
          return safeEphemeral(
            interaction,
            '❌ Choose exactly 3 questions.'
          );
        }

        db.prepare(`
          UPDATE interviewer_category_progress
          SET selected_questions = ?
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
            categoryEmbed(
              app,
              interaction.user.id,
              categoryIndex
            ),
          ],

          components:
            categoryRows(
              app,
              interaction.user.id,
              categoryIndex
            ),
        });
      }

      // =================================================
      // BEGIN SELECTED QUESTIONS
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'begin_selected:'
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app ||
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

        const selected =
          selectedQuestions(
            getProgress(
              app.id,
              interaction.user.id,
              categoryIndex
            )
          );

        if (
          selected.length !==
          3
        ) {
          return safeEphemeral(
            interaction,
            '❌ Choose exactly 3 questions first.'
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

      // =================================================
      // 0 OR 1 POINT
      // =================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'q_zero:'
          ) ||
          interaction.customId.startsWith(
            'q_one:'
          )
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
          pickRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        const pickIndex =
          Number(
            pickRaw
          );

        const point =
          interaction.customId.startsWith(
            'q_one:'
          )
            ? 1
            : 0;

        if (
          !app ||
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

        const questionNumber =
          selectedQuestions(
            getProgress(
              app.id,
              interaction.user.id,
              categoryIndex
            )
          )[
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

      // =================================================
      // QUESTION NOTES
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'q_note:'
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
          pickRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        const pickIndex =
          Number(
            pickRaw
          );

        if (
          !app ||
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

        const questionNumber =
          selectedQuestions(
            getProgress(
              app.id,
              interaction.user.id,
              categoryIndex
            )
          )[
            pickIndex
          ];

        const current =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            questionNumber
          );

        return interaction.showModal(
          notesModal(
            `q_note_modal:${app.id}:${categoryIndex}:${pickIndex}`,
            `Question ${questionNumber} Notes`,
            current?.notes ||
              ''
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'q_note_modal:'
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
          pickRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        const pickIndex =
          Number(
            pickRaw
          );

        if (
          !app ||
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

        const questionNumber =
          selectedQuestions(
            getProgress(
              app.id,
              interaction.user.id,
              categoryIndex
            )
          )[
            pickIndex
          ];

        const current =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            questionNumber
          );

        const notes =
          interaction.fields
            .getTextInputValue(
              'notes'
            )
            .trim();

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
          questionNumber,
          Number.isInteger(
            current?.point
          )
            ? current.point
            : null,
          notes
        );

        return safeEphemeral(
          interaction,
          `✅ Notes saved for Question ${questionNumber}.`
        );
      }

      // =================================================
      // PREVIOUS / NEXT SELECTED QUESTION
      // =================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'q_prev:'
          ) ||
          interaction.customId.startsWith(
            'q_next:'
          )
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
          pickRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        const pickIndex =
          Number(
            pickRaw
          );

        if (
          !app ||
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

        if (
          interaction.customId.startsWith(
            'q_prev:'
          )
        ) {
          const previous =
            Math.max(
              0,
              pickIndex -
                1
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

        const selected =
          selectedQuestions(
            getProgress(
              app.id,
              interaction.user.id,
              categoryIndex
            )
          );

        const currentQuestion =
          selected[
            pickIndex
          ];

        const currentScore =
          getQuestionScore(
            app.id,
            interaction.user.id,
            categoryIndex,
            currentQuestion
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
          2
        ) {
          return interaction.update({
            embeds: [
              categoryEmbed(
                app,
                interaction.user.id,
                categoryIndex
              ),
            ],

            components:
              categoryRows(
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

      // =================================================
      // CATEGORY NOTES
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'category_notes:'
        )
      ) {
        const [
          ,
          appId,
          categoryRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app ||
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
          getProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        return interaction.showModal(
          notesModal(
            `category_notes_modal:${app.id}:${categoryIndex}`,
            'Category Notes',
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
          appId,
          categoryRaw,
        ] =
          interaction.customId.split(
            ':'
          );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app ||
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

      // =================================================
      // VIEW MY SCORES
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'view_progress:'
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
      // FINISH SCORING
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
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
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

        const session =
          getSession(
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
          const selected =
            selectedQuestions(
              getProgress(
                app.id,
                interaction.user.id,
                i
              )
            );

          const score =
            categoryScore(
              app.id,
              interaction.user.id,
              i
            );

          if (
            selected.length !==
            3
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: choose exactly 3 questions.`
            );
          }

          if (
            score.graded !==
            3
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: grade all 3 selected questions.`
            );
          }
        }

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
          `✅ Your scoring is finished. Final score: **${overallScore(
            app.id,
            interaction.user.id
          )}/${MAX_SCORE_PER_INTERVIEWER}**.`
        );
      }

      // =================================================
      // END INTERVIEW
      //
      // OWNER / CO OWNER ONLY.
      // SCORING CHANNEL ONLY.
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

            `✅ Scores and notes will first be saved permanently in <#${INTERVIEW_RESULTS_CHANNEL_ID}>.`,

            '',

            '🗑️ Then ALL temporary interview channels will be deleted:',

            '• Applicant interview text channel',

            '• Private scoring channel',

            '• Interview voice channel',
          ].join('\n'),

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_end:${app.id}`
                  )
                  .setLabel(
                    'Yes — End Interview'
                  )
                  .setEmoji(
                    '🏁'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `cancel_end:${app.id}`
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
          'cancel_end:'
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
          'confirm_end:'
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
              '✅ Interview ended. Scores were saved permanently and all temporary text/voice/scoring channels were deleted.',

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
      // FINAL DECISION
      //
      // APPLICANT DOES NOT RECEIVE RESULT.
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
          action,
          appId,
        ] =
          interaction.customId.split(
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

        const status =
          action ===
            'final_accept'
            ? 'accepted'
            : action ===
                'final_reject'
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
          `✅ Marked ${statusLabel(
            status
          )}. The applicant was not shown the result.`
        );
      }

    } catch (error) {
      console.error(
        'Interaction error:',
        error
      );

      await safeEphemeral(
        interaction,
        `❌ ${error.message}`
      );
    }
  }
);

client.login(
  DISCORD_TOKEN
);
