/** The authenticated principal on whose behalf a use case runs. */
export interface Actor {
  readonly userId: string;
  readonly sessionId: string;
}
