import Hangman from "hangman-game-engine";
import randomWord from "random-word";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import plugin, { InteractionContinuation } from "../plugins";

export default plugin({
  id: "games",
  name: "Games",
  description: "A collection of fun games to play with friends",
  version: "0.0.1",

  commands: [
    {
      name: "hangman",
      description: "Play a game of hangman",
      minLevel: PermissionLevel.NONE,

      handler() {
        const word = randomWord();
        const game = new Hangman(word);

        return new InteractionContinuation(
          "hangman",
          game.hiddenWord.join(" "),
          game,
        );
      },
    },
  ],

  interactions: {
    hangman: {
      handler({ rest, data }) {
        if (rest.length !== 1) {
          throw new CommandError("You must provide a single letter to guess");
        }

        const game = data as Hangman;
        game.guess(rest);

        switch (game.status) {
          case "IN_PROGRESS": {
            const msg = `\
${game.hiddenWord.join(" ")}

Failed guesses: ${game.failedGuesses}/${game.totalGuesses}
* ${game.failedLetters.join(", ") || "None"}`;

            return new InteractionContinuation("hangman", msg, game);
          }

          case "WON": {
            return `You won! The word was "${game.word}"`;
          }

          case "LOST": {
            return `You lost! The word was "${game.word}"`;
          }
        }
      },
    },
  },
});
