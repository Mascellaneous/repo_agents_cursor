// Runs the role helpers from apps-script/Code.gs in Node.
// Those functions do not call Apps Script services.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const codePath = path.join(__dirname, '..', 'apps-script', 'Code.gs');
const src = fs.readFileSync(codePath, 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('missing ' + name);
    const brace = src.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unclosed ' + name);
}

const names = [
    'parseList_',
    'hashInList_',
    'rightsFromLists_',
    'rightsResponse_',
    'isMockQuestion_',
    'gitFail_',
    'stripMockQuestions_',
    'sharedMockOnly_'
];

const api = new Function(
    names.map(extractFunction).join('\n') +
    '\nreturn {' + names.join(',') + '};'
)();

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

const sample = crypto.createHash('sha256').update('sample_user', 'utf8').digest('hex');
const other = 'ab'.repeat(32);

const adminRights = api.rightsFromLists_(sample, [sample], [], []);
assert(adminRights.known && adminRights.admin && adminRights.ai && adminRights.githubSync && adminRights.mockTests, 'role_admin');

const aiRights = api.rightsFromLists_(sample, [], [sample], []);
assert(aiRights.known && !aiRights.admin && aiRights.ai && !aiRights.githubSync && aiRights.mockTests, 'role_ai');

const restrictedRights = api.rightsFromLists_(sample, [], [], [sample]);
assert(restrictedRights.known && !restrictedRights.admin && !restrictedRights.ai && !restrictedRights.githubSync && !restrictedRights.mockTests, 'role_restricted');

const none = api.rightsFromLists_(sample, [], [], []);
assert(!none.known && !none.ai && !none.githubSync && !none.mockTests && !none.admin, 'role_none');
assert(!api.rightsFromLists_(sample, ['sample_user'], [], []).known, 'role_plaintext_ignored');
assert(api.rightsFromLists_(sample, [sample], [sample], [sample]).admin === true, 'role_admin_wins');
assert(api.hashInList_(sample, sample + ', ' + other), 'role_hash_list_string');
assert(!api.hashInList_(sample, 'sample_user'), 'role_hash_list_plaintext');

const payload = api.rightsResponse_(aiRights);
const encoded = JSON.stringify(payload);
assert(payload.ok === true && payload.ai === true && payload.githubSync === false && payload.mockTests === true && payload.admin === false && payload.allowed === true, 'role_response');
assert(api.rightsResponse_(adminRights).allowed === true, 'role_response_allowed_admin');
assert(api.rightsResponse_(restrictedRights).allowed === false, 'role_response_allowed_restricted');
assert(api.rightsResponse_(none).allowed === false, 'role_response_allowed_none');
assert(api.rightsResponse_(null).allowed === false, 'role_response_allowed_empty');
assert(encoded.indexOf(sample) === -1 && encoded.indexOf('sample_user') === -1 && encoded.indexOf('known') === -1, 'role_response_leak');
assert(Object.keys(payload).sort().join(',') === 'admin,ai,allowed,githubSync,mockTests,ok', 'role_response_keys');

assert(api.isMockQuestion_({ id: 'MT27-P1-01', publisher: 'HKEAA' }), 'mock_id');
assert(!api.isMockQuestion_({ id: 'DSE-2012-P1-01', publisher: 'HKEAA' }), 'mock_dse');
assert(api.isMockQuestion_({ id: 'DSE-2012-P1-01', publisher: '雅集出版社' }), 'mock_publisher');
const stripped = JSON.parse(api.stripMockQuestions_(JSON.stringify({
    questionCount: 2,
    questions: [
        { id: 'MT27-P1-01', publisher: 'HKEAA' },
        { id: 'DSE-2012-P1-01', publisher: 'HKEAA' }
    ]
})));
assert(stripped.questionCount === 1 && stripped.questions.length === 1 && stripped.questions[0].id === 'DSE-2012-P1-01', 'mock_strip');
assert(api.sharedMockOnly_('diagrams/MT27-P1-24.jpg'), 'mock_path_diagram');
assert(api.sharedMockOnly_('originals/27/q-p1-01.jpg'), 'mock_path_original');
assert(api.sharedMockOnly_('papers/mock-tests/file.pdf'), 'mock_path_paper');
assert(api.sharedMockOnly_('data/database.js'), 'mock_path_database_js');
assert(api.sharedMockOnly_('build/report.json'), 'mock_path_build');
assert(!api.sharedMockOnly_('originals/dse/2012/q-p1-01.jpg'), 'mock_path_dse');
assert(!api.sharedMockOnly_('data/database.json'), 'mock_path_bank');
assert(!api.sharedMockOnly_('papers/past-papers/file.pdf'), 'mock_path_past');

console.log('check_role_rights ok');
