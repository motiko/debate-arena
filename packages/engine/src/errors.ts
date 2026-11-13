export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DebateCompleteError extends EngineError {}
export class HumanTurnNotSupportedError extends EngineError {}
export class EmptyTurnError extends EngineError {}
export class DebateNotFinishedError extends EngineError {}
export class VerdictParseError extends EngineError {}
export class StanceParseError extends EngineError {}
export class InvalidPanelError extends EngineError {}
export class DuplicateVoterError extends EngineError {}
export class UnknownModelPriceError extends EngineError {}
