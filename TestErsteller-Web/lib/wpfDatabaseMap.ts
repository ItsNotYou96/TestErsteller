import type { Competence } from "./types";

export const LEGACY_CLASSES = ["7", "8", "9", "10", "11", "12", "13"] as const;

export const LEGACY_TOPICS_BY_CLASS: Record<string, string[]> = {
  "7": [
    "Terme",
    "Rationale Zahlen",
    "Gleichungen",
    "Prozentrechnung",
    "Zuordnung"
  ],
  "8": [
    "Terme & Gleichungen",
    "Prozent- und Zinsrechnung",
    "Flächen",
    "Körper",
    "Statistik",
    "Funktionen"
  ],
  "9": [
    "Gleichungssysteme",
    "Lineare Funktionen",
    "Potenzen",
    "Dreiecke",
    "Körper - Fortgeschritten"
  ],
  "10": [
    "Quadratische Funktionen",
    "Exponentialfunktionen",
    "Trigonometrie",
    "Wahrscheinlichkeitsrechnung"
  ],
  "11": [],
  "12": [],
  "13": []
};

export const LEGACY_WPF_DATABASE_MAP: Record<string, Record<string, Record<Competence, string>>> = {
  "7": {
    "Terme": {
      "Argumentieren": "af24536667f145edb67b52758e13fa64",
      "Problemlösen": "10233652f4bc80d493afdcb37b188ba4",
      "Modellieren": "68e9d02b94be4a9a819afcf64dc03f5c",
      "Darstellungen": "10233652f4bc807bbe0cc6985324abae",
      "Mathematik": "10233652f4bc807487eefadeca3e6f5a",
      "Kommunizieren": "10233652f4bc80d9bfedee3bf850e44d",
    },
    "Rationale Zahlen": {
      "Argumentieren": "10233652f4bc80078ae6e16cb74fe1f4",
      "Problemlösen": "10233652f4bc8021ae96e99f5cf3a6b6",
      "Modellieren": "10233652f4bc808e85cfe21612c39a3e",
      "Darstellungen": "10233652f4bc807f873ffb5fe0259062",
      "Mathematik": "10233652f4bc802481f8da3135075698",
      "Kommunizieren": "10233652f4bc80a19a71f9702b53a5cd",
    },
    "Gleichungen": {
      "Argumentieren": "10233652f4bc8055bd2acbd3f2d58170",
      "Problemlösen": "10233652f4bc807a87dff388dae34204",
      "Modellieren": "10233652f4bc80c79b7ee309af4b6d19",
      "Darstellungen": "ffb74b9e78c64a108b09ba8ad38a9db2",
      "Mathematik": "10233652f4bc80bbb70ffb0a6bc6b123",
      "Kommunizieren": "10233652f4bc8087a2c7efa40811b7f5",
    },
    "Prozentrechnung": {
      "Argumentieren": "10233652f4bc80aeafb4f0c93ca077c9",
      "Problemlösen": "10233652f4bc801bab33d35a61a51f52",
      "Modellieren": "10233652f4bc80398fe9d8f305b3341d",
      "Darstellungen": "10233652f4bc80b5ab6ff10e3d1e25cd",
      "Mathematik": "10233652f4bc80049f8bfa723b085756",
      "Kommunizieren": "10233652f4bc803597f6cfb05020c81d",
    },
    "Zuordnung": {
      "Argumentieren": "1dc33652f4bc8058bfb6c814630c2e10",
      "Problemlösen": "1dc33652f4bc8038a165d8dbaffdbbc4",
      "Modellieren": "1dc33652f4bc80b0aa90d98f554c9764",
      "Darstellungen": "1dc33652f4bc80e6b5aaf41b0ca448b8",
      "Mathematik": "1dc33652f4bc807ea611e45e6e82d731",
      "Kommunizieren": "1dc33652f4bc80c88586f5cc0ba9bc35",
    },
  },
  "8": {
    "Terme & Gleichungen": {
      "Argumentieren": "24033652f4bc814a8973e9b6b087df93",
      "Problemlösen": "24033652f4bc818481c8c7a007cc0178",
      "Modellieren": "24033652f4bc8168b44ede53273ce896",
      "Darstellungen": "24033652f4bc816e95c2ffe4d80c4e8f",
      "Mathematik": "24033652f4bc81919f0bf0c3daa11f4c",
      "Kommunizieren": "24033652f4bc8153950def2bdd00c02f",
    },
    "Prozent- und Zinsrechnung": {
      "Argumentieren": "24033652f4bc80d5afc1d91905c8d2df",
      "Problemlösen": "24033652f4bc801daa22d7a6ea3f2459",
      "Modellieren": "24033652f4bc80ccb2b1e3270d5ccce0",
      "Darstellungen": "24033652f4bc80409ec4c0e2abf0711b",
      "Mathematik": "24033652f4bc80f89d75e2113e53e155",
      "Kommunizieren": "24033652f4bc8003a9adda2ebb674f07",
    },
    "Flächen": {
      "Argumentieren": "24033652f4bc819e969efb4b0b7cdb81",
      "Problemlösen": "24033652f4bc818482fbfab2538535e3",
      "Modellieren": "24033652f4bc81208386f8e8eb2df476",
      "Darstellungen": "24033652f4bc81a99e3cc907ba443e13",
      "Mathematik": "24033652f4bc818d8764d25f4eccb560",
      "Kommunizieren": "24033652f4bc8190833aeef5b4166cec",
    },
    "Körper": {
      "Argumentieren": "24033652f4bc810ba1efc173957673b7",
      "Problemlösen": "24033652f4bc81798b3fe7c0d7a4e19d",
      "Modellieren": "24033652f4bc8155ba24efb344403bed",
      "Darstellungen": "24033652f4bc815c8194da45db6f3769",
      "Mathematik": "24033652f4bc81a1bf55f731db04e128",
      "Kommunizieren": "24033652f4bc81caa652eb503a523d06",
    },
    "Statistik": {
      "Argumentieren": "24033652f4bc815bbf3ce7ad074ecbdc",
      "Problemlösen": "24033652f4bc8185b506db48f007e061",
      "Modellieren": "24033652f4bc814db269f460ecb52d37",
      "Darstellungen": "24033652f4bc81f9a55cf648d7399180",
      "Mathematik": "24033652f4bc81cfa5e0ffa3d2bfc33e",
      "Kommunizieren": "24033652f4bc81a3befcf70ac0882810",
    },
    "Funktionen": {
      "Argumentieren": "24033652f4bc81e1b924d830c523e92d",
      "Problemlösen": "24033652f4bc815a98c0cc8c8d6ba099",
      "Modellieren": "24033652f4bc81c2bc8bd14eb2c02620",
      "Darstellungen": "24033652f4bc81d8bd0bf382bf8d05e1",
      "Mathematik": "24033652f4bc81b0ac81cb1de8d01391",
      "Kommunizieren": "24033652f4bc81789522e3dcdcae5a35",
    },
  },
  "9": {
    "Gleichungssysteme": {
      "Argumentieren": "24033652f4bc8165a1afe44bdc80fbc7",
      "Problemlösen": "24033652f4bc8199b7e1c7c546af5da8",
      "Modellieren": "24033652f4bc81469b90fff3a416ecb4",
      "Darstellungen": "24033652f4bc810d9ab6f617e79187b1",
      "Mathematik": "24033652f4bc819abf56e654dda64e51",
      "Kommunizieren": "24033652f4bc81e6bf5be92a1d5c42ac",
    },
    "Lineare Funktionen": {
      "Argumentieren": "24033652f4bc817b95b0fbc71d2404df",
      "Problemlösen": "24033652f4bc81bdb586c01448977ed0",
      "Modellieren": "24033652f4bc8114bb5ad3436c27ec10",
      "Darstellungen": "24033652f4bc817b8ba5d301941855f9",
      "Mathematik": "24033652f4bc81d7b3f3d81704008222",
      "Kommunizieren": "24033652f4bc814db9b9e7f3da67d51a",
    },
    "Potenzen": {
      "Argumentieren": "24033652f4bc81ca9b1cddecdea17597",
      "Problemlösen": "24033652f4bc81bc9513d04fc90cb456",
      "Modellieren": "24033652f4bc8154bbd8dbed028d2f08",
      "Darstellungen": "24033652f4bc8149b0bcc88450ae81f8",
      "Mathematik": "24033652f4bc8144b071e132a95f7340",
      "Kommunizieren": "24033652f4bc81df96daed70ed5d4de4",
    },
    "Dreiecke": {
      "Argumentieren": "24033652f4bc81ee8b2bcf2fadd838f4",
      "Problemlösen": "24033652f4bc81238dd7e64085f48098",
      "Modellieren": "24033652f4bc8119adc7d3a35ec89398",
      "Darstellungen": "24033652f4bc81dcabdcc20f65122014",
      "Mathematik": "24033652f4bc81cd90abd0cd1a62902e",
      "Kommunizieren": "24033652f4bc81b5af16c61214288f31",
    },
    "Körper - Fortgeschritten": {
      "Argumentieren": "24033652f4bc81518af7fd10f226bb1c",
      "Problemlösen": "24033652f4bc81dfa9bde800914a56ca",
      "Modellieren": "24033652f4bc81799eedc585ad3aadbc",
      "Darstellungen": "24033652f4bc81b49194ff038ea8e6b0",
      "Mathematik": "24033652f4bc814385e6cb010485731e",
      "Kommunizieren": "24033652f4bc81d3ae5ed7257b7a97d2",
    },
  },
  "10": {
    "Quadratische Funktionen": {
      "Argumentieren": "24033652f4bc81ecb144e4b6d417b55c",
      "Problemlösen": "24033652f4bc81a1a138cd42b6ef7cb2",
      "Modellieren": "24033652f4bc817f9445cf89d43b101f",
      "Darstellungen": "24033652f4bc81b986d1c099a568606f",
      "Mathematik": "24033652f4bc8171935ccd42cefa43ec",
      "Kommunizieren": "24033652f4bc8180bb17d7a1ebf5dc7c",
    },
    "Exponentialfunktionen": {
      "Argumentieren": "24033652f4bc81eea977ede310fc8e61",
      "Problemlösen": "24033652f4bc812cb89ae43251db008e",
      "Modellieren": "24033652f4bc8190b71ef608fca7d787",
      "Darstellungen": "24033652f4bc8176911ad455926d17bd",
      "Mathematik": "24033652f4bc81ab9617cb9b64731817",
      "Kommunizieren": "24033652f4bc81eda583e7e05c6c78fd",
    },
    "Trigonometrie": {
      "Argumentieren": "24033652f4bc81e7a51ec65959b0e0c7",
      "Problemlösen": "24033652f4bc8195b4fbde8c0483197c",
      "Modellieren": "24033652f4bc812599d3f45ad29db209",
      "Darstellungen": "24033652f4bc81809f64e9aca52ea70f",
      "Mathematik": "24033652f4bc81878e2cd9bfc19d9ec6",
      "Kommunizieren": "24033652f4bc816e9b91fd3742d93c4e",
    },
    "Wahrscheinlichkeitsrechnung": {
      "Argumentieren": "24033652f4bc81109ca7e10509ab0a2e",
      "Problemlösen": "24033652f4bc812c91c6efd86ec7e13e",
      "Modellieren": "24033652f4bc8168b7fde7d68684a59c",
      "Darstellungen": "24033652f4bc8118aa7ec3fdf9bc2f52",
      "Mathematik": "24033652f4bc81229932f05b4168aaf4",
      "Kommunizieren": "24033652f4bc819794d6e5b481b1710d",
    },
  },
};
