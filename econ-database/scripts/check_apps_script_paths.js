// Runs the shared-path checks from apps-script/Code.gs in Node.
// Those functions do not call Apps Script services.

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
    'githubPathOk_',
    'githubIdentOk_',
    'githubBranchOk_',
    'githubSharedReady_',
    'githubSharedPrefix_',
    'sharedExt_',
    'sharedTextExt_',
    'sharedMediaType_',
    'githubSharedSegmentOk_',
    'githubSharedRelOk_',
    'githubSharedDirOk_',
    'githubSharedFilePath_',
    'githubSharedDirPath_',
    'sharedClientOk_'
];

const api = new Function(
    'var SHARED_FETCH_MAX_BYTES_ = 9000000;\n' +
    names.map(extractFunction).join('\n') +
    '\nreturn {' + names.join(',') + '};'
)();

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

assert(api.githubSharedPrefix_({ sharedPrefix: '' }) === 'shared', 'shared_prefix_default');
assert(!api.githubSharedPrefix_({ sharedPrefix: 'users' }), 'shared_prefix_users');
assert(!api.githubSharedPrefix_({ sharedPrefix: 'users/example' }), 'shared_prefix_users_child');
assert(api.githubSharedRelOk_('data/database.json'), 'shared_json');
assert(api.githubSharedRelOk_('diagrams/MT27-P1-24.jpg'), 'shared_diagram');
assert(api.githubSharedRelOk_('originals/dse/2019/q-p1-41.jpg'), 'shared_original');
assert(api.githubSharedRelOk_('papers/mock-tests/Mock Test 27 Paper 1.pdf'), 'shared_mock_name');
assert(api.githubSharedRelOk_('papers/past-papers/DSE 2012 (Chi).pdf'), 'shared_past_name');
assert(api.githubSharedRelOk_('papers/mock-tests/模擬試卷三十 卷二.pdf'), 'shared_mock_cjk');
assert(!api.githubSharedRelOk_('users/example/data/questions.json'), 'shared_blocks_users');
assert(!api.githubSharedRelOk_('../users/example/data/questions.json'), 'shared_blocks_dotdot');
assert(!api.githubSharedRelOk_('diagrams/../../users/example/x.json'), 'shared_blocks_nested_dotdot');
assert(!api.githubSharedRelOk_('/diagrams/a.jpg'), 'shared_blocks_abs');
assert(!api.githubSharedRelOk_('diagrams/a.exe'), 'shared_blocks_ext');
assert(api.githubSharedDirOk_(''), 'shared_dir_root');
assert(api.githubSharedDirOk_('papers/mock-tests'), 'shared_dir_papers');
assert(!api.githubSharedDirOk_('users'), 'shared_dir_users');
assert(!api.githubSharedDirOk_('papers/../users'), 'shared_dir_escape');
assert(api.githubSharedFilePath_({ sharedPrefix: '' }, 'diagrams/MT27-P1-24.jpg') === 'shared/diagrams/MT27-P1-24.jpg', 'shared_file_path');
assert(api.githubSharedFilePath_({ sharedPrefix: 'shared' }, 'papers/past-papers/DSE 2012 (Chi).pdf') === 'shared/papers/past-papers/DSE 2012 (Chi).pdf', 'shared_paper_path');
assert(!api.githubSharedFilePath_({ sharedPrefix: 'shared' }, 'users/example/data/questions.json'), 'shared_file_users');
assert(api.githubSharedDirPath_({ sharedPrefix: 'shared' }, '') === 'shared', 'shared_dir_path_root');
assert(api.githubSharedDirPath_({ sharedPrefix: 'shared' }, 'originals/27') === 'shared/originals/27', 'shared_dir_path_child');
assert(api.githubSharedReady_({ token: 't', owner: 'example-user', repo: 'example-repo', branch: 'main', sharedPrefix: '' }), 'shared_ready');
assert(!api.githubSharedReady_({ token: '', owner: 'example-user', repo: 'example-repo', branch: 'main', sharedPrefix: 'shared' }), 'shared_ready_token');
const sharedOut = api.sharedClientOk_({
    path: 'diagrams/MT27-P1-24.jpg',
    encoding: 'base64',
    mediaType: 'image/jpeg',
    bytes: 12,
    content: 'aaaa',
    token: 'secret-token',
    owner: 'someone',
    repo: 'private-data'
});
assert(!sharedOut.token && !sharedOut.owner && !sharedOut.repo, 'shared_response_leak');
assert(sharedOut.path === 'diagrams/MT27-P1-24.jpg' && sharedOut.encoding === 'base64', 'shared_response_keep');
assert(JSON.stringify(sharedOut).indexOf('secret-token') === -1, 'shared_response_secret');
assert(JSON.stringify(sharedOut).indexOf('private-data') === -1, 'shared_response_repo');
assert(!api.githubPathOk_('a b.json'), 'user_path_still_rejects_space');

console.log('check_apps_script_paths ok');
