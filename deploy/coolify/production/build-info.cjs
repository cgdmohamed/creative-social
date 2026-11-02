const fs = require('node:fs');
const path = require('node:path');
const { publicOrigin, revision } = require('./validate-env.cjs');
const info = {
  publicUrl: publicOrigin(process.argv[2]),
  revision: revision(process.argv[3]),
};
fs.writeFileSync(path.join(__dirname, 'build-info.json'), JSON.stringify(info));
