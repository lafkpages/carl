import type { InteractionArgs, InteractionResult } from "../../plugins";

import Hangman from "hangman-game-engine";
import randomWord from "random-word";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { InteractionContinuation, Plugin } from "../../plugins";

export default class extends Plugin<"games"> {
  readonly id = "games";
  readonly name = "Games";
  readonly description = "A collection of fun games to play with friends";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "hangman",
        description: "Play a game of hangman",
        minLevel: PermissionLevel.NONE,

        handler() {
          const word = randomWord();
          const game = new Hangman(word);

          return new InteractionContinuation(
            game.hiddenWord.join(" "),
            this,
            this.hangmanContinuation,
            game,
          );
        },
      },
    ]);
  }

  hangmanContinuation({ message, data }: InteractionArgs): InteractionResult {
    if (message.body.length !== 1) {
      throw new CommandError("You must provide a single letter to guess");
    }

    const game = data as Hangman;
    game.guess(data);

    switch (game.status) {
      case "IN_PROGRESS": {
        const msg = `\
${game.hiddenWord.join(" ")}

Failed guesses: ${game.failedGuesses}/${game.totalGuesses}
* ${game.failedLetters.join(", ") || "None"}`;

        return new InteractionContinuation(
          msg,
          this,
          this.hangmanContinuation,
          game,
        );
      }

      case "WON": {
        return `You won! The word was "${game.word}"`;
      }

      case "LOST": {
        return `You lost! The word was "${game.word}"`;
      }
    }
  }
}
