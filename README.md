# WhatsApp PA

A customisable, extendable and powerful multi-purpose WhatsApp bot, built using [Bun][bun] and [whatsapp-web.js](https://wwebjs.dev).

## Screenshots

![screenshot of help command][img-help]
![screenshot of games plugin][img-hangman]

## Usage

> [!NOTE]
> This bot is designed to be run on its own WhatsApp account, and is not intended to be used on a personal account.

To run the bot on your own account, you will need [Bun][bun] installed on your system. Follow the instructions on the [Bun documentation][buni] to install it.

You will also need Git installed on your system. You probably already have it, but if you don't, you can download it from the [official Git website](https://git-scm.com).

Once you have installed Bun, clone this repository:

```sh
git clone https://github.com/lafkpages/whatsapp-pa.git
```

Then, navigate to the directory and install the dependencies:

```sh
cd whatsapp-pa
bun install
```

Then make a copy of the `config.example.json` file and call it `config.json`. This file contains the configuration for the bot, such as the plugins to enable, the users to trust, rate-limits, command aliases, and more.

Then, run the bot:

```sh
bun run .
```

The bot will start and display a QR code. Scan this QR code with your WhatsApp account to log in.

## Configuration

The `config.json` file contains the configuration for the bot. To use the bot, you must whitelist your user ID. To find your user ID, send the command `/whoami` to the bot. It will reply with your user ID. Then, add this user ID to the `whitelist.admin` key in the `config.json` file, like so:

```json
{
  "whitelist": {
    "admin": ["your-user-id-here"]
  }
}
```

Then, run `/stop` to gracefully stop the bot, and then restart it. You should now be able to use all the commands.

## Plugins

The bot is designed to be easily extendable with plugins. You can enable or disable plugins in the `config.json` file. WhatsApp PA comes with a few built-in plugins, such as:

- `admin-utils`: A collection of utilities to ease administration of the bot.
- `config`: An admin-only plugin to view and update the bot's configuration.
- `debug`: A plugin to help debug the bot.
- `dictionary`: A plugin to look up words in the dictionary, using the [Free Dictionary API][dictapi].
- `football`: A plugin to get information about football matches, from [football-data.org][fbapi].
- `isitwater`: A fun plugin to check if a location is on land or on water, using the [IsItWater API][isitwater].
- `latex`: _WIP_ A plugin to render LaTeX code and equations as images, using [latex2image][latex2i].
- `math`: A mathematical computations plugin with symbolic and numerical calculations, using [metadelta][metadelta].
- `numberfacts`: A plugin to get interesting facts about numbers (and dates). Uses the [Numbers API][numapi].
- `openai`: _WIP_ A plugin to interact with ChatGPT via WhatsApp.
- `random`: A plugin to generate random numbers, strings, coin flips, jokes, and more.
- `translate`: A plugin to translate text between languages, using a customisable instance of [LibreTranslate][lbtr].
- `veriphone`: A plugin to lookup phone number information on [Veriphone][veriphone].
- `viewonce`: A plugin to view view-once media messages.

These can be enabled or disabled in the `config.json` file.

### Custom plugins

You can place your own custom plugins in the `src/plugins/custom` directory. Each plugin should be a separate file, and should export a class that extends the `Plugin` class from `src/plugins.ts`. An example can be found in `src/plugins/TEMPLATE.ts`.

[img-help]: https://cloud-bjfqs2qm5-hack-club-bot.vercel.app/0whatsapp-pa-help.jpg
[img-hangman]: https://scrapbook-into-the-redwoods.s3.amazonaws.com/5a0c323c-ef7c-49ab-93b5-c01408e3ecb1-whatsapp-pa-hangman.jpeg
[bun]: https://bun.sh
[buni]: https://bun.sh/docs/installation
[dictapi]: https://dictionaryapi.dev
[fbapi]: https://www.football-data.org
[isitwater]: https://isitwater.com
[latex2i]: https://latex2image.joeraut.com
[metadelta]: https://github.com/metadelta/metadelta
[numapi]: http://numbersapi.com
[lbtr]: https://libretranslate.com
[veriphone]: https://veriphone.io
