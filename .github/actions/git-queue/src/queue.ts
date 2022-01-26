import {DefaultLogFields, SimpleGit, CheckRepoActions, GitResponseError} from 'simple-git';

class Message {
  commit: DefaultLogFields;

  constructor(commit: DefaultLogFields) {
    this.commit = commit;
  }

  commitHash(): String {
    return this.commit.hash;
  }

  payload(): String {
    return this.commit.body.trim();
  }

  isEmpty(): Boolean {
    return this instanceof NoMessage;
  }
}

class NoMessage extends Message {}
class CreateJobMessage extends Message {}
class MarkJobAsDoneMessage extends Message {}

class Commit {
  hash: string;

  constructor(hash: string) {
    this.hash = hash;
  }
}

function noMessage() {
  return new NoMessage({
    hash: '',
    date: '',
    message: 'no-message',
    refs: '',
    body: '',
    author_name: '',
    author_email: ''
  });
}

export class Queue {
  name: string;
  gitRepoDir: string;
  git: SimpleGit;
  messages: ReadonlyArray<Message>;

  readonly CREATE_JOB_SUBJECT_PREFIX = 'CLAIM LOCK: JOB: ';
  readonly MARK_JOB_AS_DONE_SUBJECT_PREFIX = 'RELEASE LOCK: JOB DONE: ';

  private constructor(name: string, gitRepoDir: string, git: SimpleGit) {
    this.name = name;
    this.gitRepoDir = gitRepoDir;
    this.git = git;
    this.messages = [];
  }

  static async create(name: string, gitRepoDir: string, git: SimpleGit): Promise<Queue> {
    let queue = new Queue(name, gitRepoDir, git);
    await queue.loadMessagesFromGit();
    return queue;
  }

  async loadMessagesFromGit() {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw Error(`Invalid git dir: ${this.gitRepoDir}`);
    }

    const status = await this.git.status();
    const currentBranch = status.current;

    try {
      const gitLog = await this.git.log();
      const commits = gitLog.all.filter(commit => this.commitBelongsToQueue(commit));
      this.messages = commits.map(commit => this.messageFactory(commit));
    } catch (err) {
      if ((err as GitResponseError).message.includes(`fatal: your current branch '${currentBranch}' does not have any commits yet`)) {
        // no commits yet
      } else {
        throw err;
      }
    }
  }

  commitBelongsToQueue(commit: DefaultLogFields) {
    return this.isCreateJobCommit(commit) || this.isMarkJobAsDoneCommit(commit) ? true : false;
  }

  messageFactory(commit: DefaultLogFields) {
    if (this.isCreateJobCommit(commit)) {
      return new CreateJobMessage(commit);
    }

    if (this.isMarkJobAsDoneCommit(commit)) {
      return new MarkJobAsDoneMessage(commit);
    }

    throw new Error(`Invalid queue message in commit: ${commit.hash}`);
  }

  createJobCommitSubject() {
    return `${this.CREATE_JOB_SUBJECT_PREFIX}${this.name}`;
  }

  markJobAsDoneCommitSubject() {
    return `${this.MARK_JOB_AS_DONE_SUBJECT_PREFIX}${this.name}`;
  }

  isCreateJobCommit(commit: DefaultLogFields): boolean {
    return commit.message == this.createJobCommitSubject() ? true : false;
  }

  isMarkJobAsDoneCommit(commit: DefaultLogFields): boolean {
    return commit.message == this.markJobAsDoneCommitSubject() ? true : false;
  }

  getMessages(): ReadonlyArray<Message> {
    return this.messages;
  }

  getLatestMessage(): Message {
    return this.isEmpty() ? noMessage() : this.messages[0];
  }

  isEmpty(): boolean {
    return this.messages.length == 0;
  }

  getNextJob(): Message {
    const latestMessage = this.getLatestMessage();
    return latestMessage instanceof CreateJobMessage ? latestMessage : noMessage();
  }

  guardThatThereIsNoPendingJobs() {
    if (!this.getNextJob().isEmpty()) {
      throw new Error(`Can't create a new job. There is already a pending job in commit: ${this.getNextJob().commitHash()}`);
    }
  }

  guardThatThereIsAPendingJob() {
    if (this.getNextJob().isEmpty()) {
      throw new Error(`Can't mark job as done. There isn't any pending job`);
    }
  }

  async commitAndPush(message: string[], signingKey: string = ''): Promise<Commit> {
    const commit = await this.commit(message, signingKey);
    this.push();
    return commit;
  }

  async commit(message: string[], signingKey: string = ''): Promise<Commit> {
    const commitResult = await this.git.commit(message, this.commitOptions(signingKey));
    await this.loadMessagesFromGit();
    return new Commit(commitResult.commit);
  }

  async push() {
    if ((await this.git.remote([])) != '') {
      this.git.push();
    }
  }

  commitOptions(signingKey: string = '') {
    return {
      '--allow-empty': null,
      ...(signingKey == '' && {'--no-gpg-sign': null}),
      ...(signingKey != '' && {
        '--gpg-sign': signingKey
      })
    };
  }

  async dispatch(payload: string, signingKey: string = ''): Promise<Commit> {
    this.guardThatThereIsNoPendingJobs();

    const message = [`${this.createJobCommitSubject()}`, `${payload}`];

    const commit = await this.commitAndPush(message, signingKey);

    return commit;
  }

  async markJobAsDone(payload: string, signingKey: string = '') {
    this.guardThatThereIsAPendingJob();

    const message = [`${this.markJobAsDoneCommitSubject()}`, `${payload}`];

    const commit = await this.commitAndPush(message, signingKey);

    return commit;
  }
}
