import type { Plugin } from "../plugins";

import { boolean, object, parse, picklist, string } from "valibot";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const apiKey = process.env.VERIPHONE_API_KEY;

if (!apiKey) {
  throw new Error("$VERIPHONE_API_KEY environment variable must be set");
}

const schema = object({
  status: picklist(["success", "error"]),
  phone: string(),
  phone_valid: boolean(),
  phone_type: picklist([
    "fixed_line",
    "mobile",
    "unknown",
    "fixed_line_or_mobile",
    "toll_free",
    "premium_rate",
    "shared_cost",
    "voip",
  ]),
  phone_region: string(),
  country: string(),
  country_code: string(),
  country_prefix: string(),
  international_number: string(),
  local_number: string(),
  e164: string(),
  carrier: string(),
});

export default {
  id: "veriphone",
  name: "Veriphone",
  description: "Verifies and looks up phone numbers using the Veriphone API",
  version: "0.0.1",

  commands: [
    {
      name: "veriphone",
      description: "Looks up a phone number",
      minLevel: PermissionLevel.NONE,
      rateLimit: [
        {
          duration: 10000,
          max: 1,
        },
      ],

      async handler({ message, rest }) {
        let phoneNumber = "";

        if (rest) {
          phoneNumber = rest;
        } else {
          const contact = await message.getContact();
          phoneNumber = contact.number;
        }

        const data = parse(
          schema,
          await fetch(
            `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(phoneNumber)}&key=${encodeURIComponent(apiKey!)}`,
          ).then((r) => r.json()),
        );

        if (data.status === "error") {
          throw new CommandError("failed to look up phone number");
        }

        if (!data.phone_valid) {
          throw new CommandError("phone number is not valid");
        }

        return `\
*Phone number: ${data.phone}*
* International number: ${data.international_number}
* Local number: ${data.local_number}
* E164 number: ${data.e164}
* Country: ${data.country} (${data.country_code})
* Region: ${data.phone_region} (${data.country_prefix})
* Type: ${data.phone_type}
* Carrier: ${data.carrier}`;
      },
    },
  ],
} satisfies Plugin;
