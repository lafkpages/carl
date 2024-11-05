import Hangman from "hangman-game-engine";
import randomWord from "random-word";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

export default new Plugin(
  "games",
  "Games",
  "A collection of fun games to play with friends",
)
  .registerInteraction({
    name: "hangman",
    handler({ message, data }) {
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

          return this.interactionContinuation("hangman", msg, game);
        }

        case "WON": {
          return `You won! The word was "${game.word}"`;
        }

        case "LOST": {
          return `You lost! The word was "${game.word}"`;
        }
      }
    },
  })
  .registerCommand({
    name: "hangman",
    description: "Play a game of hangman",
    minLevel: PermissionLevel.NONE,

    handler() {
      const word = randomWord();
      const game = new Hangman(word);

      return this.interactionContinuation(
        "hangman",
        game.hiddenWord.join(" "),
        game,
      );
    },
  });
