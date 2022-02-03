import * as core from '@actions/core';
import * as context from './context';
import {SimpleGit} from 'simple-git';
import {Queue} from './queue';
import {CommitAuthor, emptyCommitAuthor} from './commit-author';
import {CommitOptions} from './commit-options';
import {emptySigningKeyId, SigningKeyId} from './signing-key-id';
import {Inputs} from './context';
import {getGnupgHome} from './gpg-env';
import {createInstance} from './simple-git-factory';
import {checkIsBareRepoTask} from 'simple-git/src/lib/tasks/check-is-repo';

const ACTION_CREATE_JOB = 'create-job';
const ACTION_NEXT_JOB = 'next-job';
const ACTION_MARK_JOB_AS_DONE = 'mark-job-as-done';

function actionOptions(): string {
  const options = [ACTION_CREATE_JOB, ACTION_NEXT_JOB, ACTION_MARK_JOB_AS_DONE];
  return options.toString();
}

async function getCommitAuthor(commitAuthor: string, git: SimpleGit): Promise<CommitAuthor> {
  if (commitAuthor) {
    return CommitAuthor.fromEmailAddressString(commitAuthor);
  }
  return emptyCommitAuthor();
}

async function getSigningKeyId(signingKeyId: string, git: SimpleGit): Promise<SigningKeyId> {
  if (signingKeyId) {
    return new SigningKeyId(signingKeyId);
  }
  return emptySigningKeyId();
}

async function getCommitOptions(inputs: Inputs, git: SimpleGit): Promise<CommitOptions> {
  const author = await getCommitAuthor(inputs.gitCommitAuthor, git);
  const gpgSign = await getSigningKeyId(inputs.gitCommitGpgSign, git);
  const noGpgSig = inputs.gitCommitNoGpgSign;

  return new CommitOptions(author, gpgSign, noGpgSig);
}

async function run(): Promise<void> {
  try {
    let inputs: context.Inputs = await context.getInputs();

    const gitRepoDir = inputs.gitRepoDir ? inputs.gitRepoDir : process.cwd();
    const gnuPGHomeDir = await getGnupgHome();

    await core.group(`Debug info`, async () => {
      core.info(`git_repo_dir: ${gitRepoDir}`);
      core.info(`gnupg_home_dir: ${gnuPGHomeDir}`);
    });

    const git = await createInstance(gitRepoDir);

    let queue = await Queue.create(inputs.queueName, gitRepoDir, git);

    const commitOptions = await getCommitOptions(inputs, git);

    switch (inputs.action) {
      case ACTION_CREATE_JOB:
        const createJobCommit = await queue.createJob(inputs.jobPayload, commitOptions);

        await core.group(`Setting outputs`, async () => {
          context.setOutput('job_created', true);
          context.setOutput('job_commit', createJobCommit.hash);

          core.info(`job_created: true`);
          core.info(`job_commit: ${createJobCommit.hash}`);
        });

        break;

      case ACTION_NEXT_JOB:
        const nextJob = queue.getNextJob();

        await core.group(`Setting outputs`, async () => {
          context.setOutput('job_found', !nextJob.isEmpty());

          if (!nextJob.isEmpty()) {
            context.setOutput('job_commit', nextJob.commitHash());
            context.setOutput('job_payload', nextJob.payload());

            core.info(`job_commit: ${nextJob.commitHash()}`);
            core.info(`job_payload: ${nextJob.payload()}`);
          }
        });

        break;

      case ACTION_MARK_JOB_AS_DONE:
        const markJobAsDoneCommit = await queue.markJobAsDone(inputs.jobPayload, commitOptions);

        await core.group(`Setting outputs`, async () => {
          // TODO: 'commit_created' or 'job_marked_as_done' or 'job_updated' instead of 'job_created'
          context.setOutput('job_created', true);
          context.setOutput('job_commit', markJobAsDoneCommit.hash);

          core.info(`job_created: true`);
          core.info(`job_commit: ${markJobAsDoneCommit.hash}`);
        });

        break;
      default:
        core.error(`Invalid action. Actions can only be: ${actionOptions}`);
    }
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
