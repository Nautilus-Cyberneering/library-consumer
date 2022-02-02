import {CommitAuthor} from './commit-author';
import {SigningKeyId} from './signing-key-id';

export class CommitOptions {
  author: CommitAuthor;
  gpgSig: SigningKeyId;
  noGpgSig: boolean;

  constructor(author: CommitAuthor, gpgSig: SigningKeyId, noGpgSig: boolean) {
    this.author = author;
    this.gpgSig = gpgSig;
    this.noGpgSig = noGpgSig;
  }

  forSimpleGit() {
    return {
      '--allow-empty': null,
      ...(!this.author.isEmpty() && {'--author': `"${this.author.toString()}"`}),
      ...(!this.gpgSig.isEmpty() && {
        '--gpg-sign': this.gpgSig.toString()
      }),
      ...(this.noGpgSig && {'--no-gpg-sign': null})
    };
  }

  toString(): string {
    const allowEmpty = '--allow-empty';
    const author = this.author.isEmpty() ? '' : `--author="${this.author.toString()}"`;
    const gpgSig = this.gpgSig.isEmpty() ? '' : `--gpg-sign=${this.gpgSig.toString()}`;
    const noGpgSig = this.noGpgSig ? '--no-gpg-sign' : '';
    return `${allowEmpty} ${author} ${gpgSig} ${noGpgSig}`;
  }
}
