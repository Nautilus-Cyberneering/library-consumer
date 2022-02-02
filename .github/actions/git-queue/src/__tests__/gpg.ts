import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as openpgp from './openpgp';
import {getGnupgHome} from '../gpg-env';

export const agentConfig = `default-cache-ttl 7200
max-cache-ttl 31536000
allow-preset-passphrase`;

const gpgConnectAgent = async (command: string, homedir: string): Promise<string> => {
  const cmd = `gpg-connect-agent --homedir ${homedir} "${command}" /bye`;

  return await exec
    .getExecOutput(cmd, [], {
      ignoreReturnCode: true,
      silent: true
    })
    .then(res => {
      if (res.stderr.length > 0 && res.exitCode != 0) {
        throw new Error(res.stderr);
      }
      for (let line of res.stdout.replace(/\r/g, '').trim().split(/\n/g)) {
        if (line.startsWith('ERR')) {
          throw new Error(line);
        }
      }
      return res.stdout.trim();
    });
};

export const importKey = async (key: string, homedir: string): Promise<string> => {
  const keyFolder: string = fs.mkdtempSync(path.join(os.tmpdir(), 'ghaction-import-gpg-'));
  const keyPath: string = `${keyFolder}/key.pgp`;

  fs.writeFileSync(keyPath, (await openpgp.isArmored(key)) ? key : Buffer.from(key, 'base64').toString(), {mode: 0o600});

  const args = ['--homedir', homedir, '--import', '--batch', '--yes', keyPath];

  return await exec
    .getExecOutput('gpg', args, {
      ignoreReturnCode: true,
      silent: true
    })
    .then(res => {
      if (res.stderr.length > 0 && res.exitCode != 0) {
        throw new Error(res.stderr);
      }
      if (res.stderr != '') {
        return res.stderr.trim();
      }
      return res.stdout.trim();
    })
    .finally(() => {
      fs.unlinkSync(keyPath);
    });
};

export const getKeygrips = async (fingerprint: string, homedir: string): Promise<Array<string>> => {
  const args = ['--homedir', homedir, '--batch', '--with-colons', '--with-keygrip', '--list-secret-keys', fingerprint];

  return await exec
    .getExecOutput('gpg', args, {
      ignoreReturnCode: true,
      silent: true
    })
    .then(res => {
      let keygrips: Array<string> = [];
      for (let line of res.stdout.replace(/\r/g, '').trim().split(/\n/g)) {
        if (line.startsWith('grp')) {
          keygrips.push(line.replace(/(grp|:)/g, '').trim());
        }
      }
      return keygrips;
    });
};

export const overwriteAgentConfiguration = async (config: string, homedir: string): Promise<void> => {
  const gpgAgentConfPath: string = path.join(homedir, 'gpg-agent.conf');

  await fs.writeFile(gpgAgentConfPath, config, function (err) {
    if (err) throw err;
  });

  await gpgConnectAgent('RELOADAGENT', homedir);
};

export const presetPassphrase = async (keygrip: string, passphrase: string, homedir: string): Promise<string> => {
  const hexPassphrase: string = Buffer.from(passphrase, 'utf8').toString('hex').toUpperCase();
  await gpgConnectAgent(`PRESET_PASSPHRASE ${keygrip} -1 ${hexPassphrase}`, homedir);
  return await gpgConnectAgent(`KEYINFO ${keygrip}`, homedir);
};
