# Data sources

## Vocabulary

The vocabulary in `Server/src/vocab/words.ts` is derived from [OpenJLPT](https://github.com/evanclan/OpenJLPT) and is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). OpenJLPT uses:

- JMdict, by the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/edrdg/licence.html) (CC BY-SA 4.0)
- [Jonathan Waller's JLPT lists](https://www.tanos.co.uk/jlpt/) (CC BY), for N5–N1 levels and English meanings
- [Tatoeba](https://tatoeba.org) (CC BY 2.0 FR), for example sentences

JLPT levels are unofficial. The JLPT organizers don't publish vocabulary lists.

## Word frequency

The frequency ranks in the same file are computed from [TUBELEX](https://github.com/naist-nlp/tubelex), a word list built from YouTube subtitles. Words the corpus splits into parts have estimated ranks. TUBELEX is distributed under this license:

```
BSD 3-Clause License

Copyright (c) 2022-4, Adam Nohejl
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
