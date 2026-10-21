/**
 * report.ts — Telling the parent about a definition file it cannot use.
 *
 * A duplicate identifier is a problem only the operator can fix: one of the
 * two files has to go. The parent is the one that can say so, so the runtime
 * says so once per problem — not once per spawn.
 */

/** Reports a message to the parent. */
export type DefinitionErrorSink = (message: string) => void;

/**
 * Remembers which definition errors the parent has already been told about.
 *
 * A problem is reported once. It stops being reported when it goes away, and
 * comes back if the operator creates it again.
 */
export class DefinitionErrorReporter {
  private readonly reported = new Set<string>();

  constructor(private readonly report: DefinitionErrorSink) {}

  /**
   * Report the errors that are new, and remember them.
   *
   * An error that has been reported before is not reported again, so a
   * definition file that stays broken does not fill the parent's transcript
   * with the same complaint.
   */
  reportNew(errors: readonly string[]): void {
    const unseen = errors.filter((error) => !this.reported.has(error));
    for (const error of errors) this.reported.add(error);
    if (unseen.length === 0) return;
    this.report(`Subagent definitions: ${unseen.join("\n")}`);
  }
}
