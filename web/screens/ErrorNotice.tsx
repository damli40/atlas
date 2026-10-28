// X2 (for G1): an error line that, when the server asked for an invite code (HTTP 401 from the invite gate), also
// links to the page where the person types it. The server's own sentence is shown as it came.
export const INVITE_PAGE = "/api/invite";
export const asksForInvite = (message: string) => /needs an invite code/i.test(message);

export function ErrorNotice({ message, testId }: { message: string; testId?: string }) {
  return (
    <p className="notice" role="alert" {...(testId ? { "data-testid": testId } : {})}>
      {message}
      {asksForInvite(message) ? (
        <>
          {" "}
          <a href={INVITE_PAGE} data-testid="invite-link">
            Enter your invite code
          </a>
          , then come back and try again.
        </>
      ) : null}
    </p>
  );
}
