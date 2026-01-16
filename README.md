# xchat-userscripts
Uživatelské skripty pro rozšíření funkcionality webu XChat.cz

## Seznam skriptů

### `xchat-room-favourite-emojis.user.js`
- **Oblíbení smajlíci v místnosti navíc
- Zvětší frame a přidá další oblíbené smajlíky

### `xchat-disable-room-popup.user.js`
- **Historie místností**
- Skryje vyskakovací okno s potvrzením věku v seznamu místností

### `xchat-precommander.user.js`
- **Příkazy do místností (Modchat / textpageng)**
- Rozšiřuje příkazový systém v místnosti o administrátorské a uživatelské příkazy.
- Skript se aktivuje pouze na textovém vstupu místnosti a funguje i při reloadu iframe.

### `xchat-room-sidebar-hide.user.js`
- **Skryje sidebar v místnosti**
- Skryje černý rozevírací sidebar v místnosti

#### Podporované příkazy

##### Poznámky
- `/note nick [poznámka]`  
  Uloží poznámku k uživateli.  
  Poznámka je volitelná, nick je povinný.

- `/unnote nick`  
  Odebere poznámku k uživateli.

##### Informace o uživateli
- `/showip nick`  
  Zjistí a vypíše IP adresu a doménu/hostname uživatele.  
  Informace jsou získány z administrace XChat (IP extended).

##### Moderace – blokace
- `/ban nick důvod`  
  Zablokuje uživatele:
  - blokace vždy na **1 rok**
  - sankce: **kompletní blokace (sanction_8)**
  - `user_description` je pevně:
    > Založení nového účtu za účelem obcházení blokace na jiném účtu
  - jako admin je použit aktuální nick uživatele
  - room ID (RID) je vždy převzato z aktuální místnosti

- `/unban nick`  
  Odblokuje uživatele:
  - zjistí UID uživatele
  - vyhledá všechny aktivní blokace
  - všechny aktivní blokace odstraní

##### Moderace – mazání textů
- `/clearnick nick`  
  Smaže všechny texty daného uživatele (cleartext).

#### Výstupy
- Veškeré odpovědi skriptu jsou odesílány zpět do místnosti ve tvaru:
