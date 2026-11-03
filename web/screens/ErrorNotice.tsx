// X2 (for G1): an error line that, when the server asked for an invite code (HTTP 401 from the invite gate), also
// links to the page where the person types it. The server's own sentence is shown as it came.
// R10 (D72): that line also offers "Join the waitlist" (the form at ATLAS_WAITLIST_URL, when the server names one) and
// "I have a code". The example on the first screen needs no code; this is for everything beyond it.
export const INVITE_PAGE = "/api/invite";
export const asksForInvite = (message: string) => /needs an invite code/i.test(message);

/** R10 (D72): the waitlist form the server named (GET /invite/status), kept for this page. Only a plain https address is used. */
let waitlistUrl: string | null = null;
export function noteWaitlist(url: string | null | undefined): void {
  waitlistUrl = typeof url === "string" && /^https:\/\/[^\s"'<>`]+$/.test(url) ? url : null;
}
export const waitlist = (): string | null => waitlistUrl;

/** R10 (D72): "Join the waitlist · I have a code". Placeholder words for Dami. */
export function InviteLinks() {
  const url = waitlistUrl;
  return (
    <span className="invite-links" data-testid="invite-links">
      {/* DAMI: placeholder wording for both links. */}
      {url ? (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" data-testid="waitlist-link">
            Join the waitlist
          </a>
          {" · "}
        </>
      ) : null}
      <a href={INVITE_PAGE} data-testid="invite-link">
        I have a code
      </a>
    </span>
  );
}

export function ErrorNotice({ message, testId }: { message: string; testId?: string }) {
  return (
    <p className="notice" role="alert" {...(testId ? { "data-testid": testId } : {})}>
      {message}
      {asksForInvite(message) ? (
        <>
          {" "}
          <InviteLinks />
        </>
      ) : null}
    </p>
  );
}
