**Functioneel Ontwerp - StageTimer / Show Control applicatie**

Versie: 0.2

Status: bijgewerkt na functionele review

Dit document beschrijft de functionele opzet en het gedrag van de
applicatie. Technische implementatiekeuzes, databaseontwerp, frameworks
en concrete API-endpoints vallen buiten deze versie.

**1. Productvisie**

De applicatie is in de kern een StageTimer die een volledige show kan
begrijpen, niet een uitgebreid eventmanagementsysteem waar toevallig een
timer in zit.

De belangrijkste ontwerpgedachte is:

"Eenvoud als uitgangspunt, complexiteit alleen wanneer de gebruiker die
nodig heeft."

Een nieuwe gebruiker moet binnen enkele seconden een timer kunnen
starten zonder account, configuratiewizard, Event, Room of andere
voorbereiding.

Dezelfde eenvoudige timer moet vervolgens kunnen doorgroeien naar een
volledige show met een queue, meerdere outputs, meerdere disciplines,
meerdere ruimtes en uiteindelijk een compleet evenement.

Daarmee kent het product grofweg een natuurlijke groeilijn:

Timer  
-\> Queue  
-\> Show  
-\> Multi-queue Show  
-\> Event  
-\> Multi-room Event

Dit zijn nadrukkelijk geen verschillende producten of modi. Het zijn
verschillende niveaus waarop dezelfde onderliggende functionaliteit
wordt gebruikt.

Een belangrijk principe daarbij is:

"Complexiteit is opt-in."

Een gebruiker die alleen een countdown nodig heeft, hoeft nooit te weten
dat Events, parallelle queues, audiences, devices of Actions bestaan.

**2. Kernprincipes**

Data en presentatie zijn volledig gescheiden.

Een Queue Item bevat informatie en status. Een Board bepaalt welke
informatie wordt weergegeven en hoe die wordt weergegeven.

Een timer is dus niet gekoppeld aan één bepaald stage-scherm.

Dezelfde data kan bijvoorbeeld gelijktijdig worden weergegeven als:

Speaker Board  
12:43

Stage Manager Board  
JAN JANSEN  
12:43  
NEXT: PANEL

FOH Board  
CURRENT: Keynote  
12:43  
SHOW +04:12 BEHIND

Public Board  
Keynote  
Jan Jansen  
10:00 - 10:30

De software informeert; de operator beslist.

De applicatie mag rekenen, voorspellen, afwijkingen tonen en voorstellen
doen. Tijdens een productie worden echter geen ingrijpende wijzigingen
stilzwijgend doorgevoerd.

De datastructuur blijft zo vlak mogelijk.

Er wordt bewust voorkomen dat de gebruiker structuren krijgt als:

Event  
-\> Room  
-\> Show  
-\> Session  
-\> Cue  
-\> Timer

De kracht moet vooral uit Queue Items, properties, relaties en
verschillende Views komen.

**3. Hoofdstructuur**

De functionele hoofdstructuur wordt:

Event optional  
\|  
+-- Room / Area optional  
\|  
+-- Show  
\|  
+-- Queue  
\| +-- Group  
\| \| +-- Queue Item  
\| +-- Queue Item  
\|  
+-- Queue  
+-- Queue

Daarnaast bestaan onder andere:

Boards  
Devices  
Users  
Audiences  
Actions  
Messages

Deze onderdelen maken gebruik van de informatie in de Show, maar vormen
geen extra verplichte lagen in de programmatische structuur.

**4. Quick Timer en New Show**

De laagste instap moet extreem eenvoudig zijn.

Op de homepage moet een gebruiker bijvoorbeeld direct kunnen kiezen
voor:

New Timer

Daarna kan onmiddellijk een countdown worden ingevoerd:

05:00  
START

Er is hiervoor geen account nodig.

Onder water ontstaat hierbij reeds een minimale Show met een Queue en
Queue Item, maar de gebruiker hoeft hiervan niets te merken.

Wanneer de gebruiker meer nodig heeft kan diezelfde timer worden
uitgebreid:

05:00

wordt bijvoorbeeld:

Spreker Jan 05:00  
Pauze 10:00  
Spreker Marie 20:00

Daarna kunnen eventueel Boards, Rooms, Events en andere functionaliteit
worden toegevoegd.

**5. Event**

Een Event is een optionele container voor grotere producties.

Voorbeelden:

- congres
- beurs
- festival
- corporate event
- conferentie met meerdere ruimtes

Een Event kan meerdere Shows bevatten.

Een gebruiker die alleen een StageTimer nodig heeft hoeft nooit een
Event aan te maken.

Een Event biedt onder andere een centrale plek voor:

- Shows
- Rooms/Areas
- Boards
- Devices
- gebruikers
- algemene statusinformatie
- centrale monitoring

**6. Room / Area**

Rooms en Areas zijn eveneens optioneel.

Een Room kan bijvoorbeeld zijn:

Main Stage  
Workshop Room A  
Workshop Room B  
Foyer  
Backstage

Een Show kan aan één Room/Area tegelijk gekoppeld zijn.

Wanneer dezelfde Show-inhoud in een andere Room gebruikt moet worden,
wordt deze gedupliceerd. Hierdoor kunnen beide exemplaren daarna
onafhankelijk worden aangepast.

Dit is belangrijk voor de praktijk waarin last-minute wijzigingen per
ruimte vrijwel onvermijdelijk zijn.

Een Room kan gedurende een Event meerdere Shows bevatten, bijvoorbeeld
een ochtend- en avondprogramma.

**7. Show**

De Show is het belangrijkste zelfstandige object van de applicatie.

Een Show kan bestaan:

- zonder Event
- zonder Room
- gekoppeld aan een Event
- gekoppeld aan een Room binnen een Event

De Show bevat één of meerdere Queues.

Een eenvoudige Show heeft bijvoorbeeld alleen:

Program

Een complexere productie kan hebben:

Program  
Stage Management  
Audio  
Lighting  
Video  
Broadcast

De Show bevat ook algemene defaults, bijvoorbeeld voor:

- timerwaarschuwingen
- timinggedrag
- kleuren
- visibility
- gedrag bij timer-einde

Queues en individuele Queue Items mogen deze defaults overrulen.

Het algemene overervingsmodel wordt daarmee:

Show defaults  
-\> Queue settings  
-\> Queue Item override

**Zichtbaarheid van overerving en overrides**

Voor iedere overerfbare instelling moet in Master en, waar operationeel
relevant, in de Operator View zichtbaar zijn waar de actuele waarde
vandaan komt: Show default, Queue setting of Queue Item override.

Warning settings: Item override  
Source: Queue Item  
Reset to Queue default

Een override krijgt een compact visueel kenmerk, bijvoorbeeld een
override-icoon of label. Dit principe geldt generiek voor alle
instellingen die volgens het Show -\> Queue -\> Queue Item-model kunnen
worden overruled, niet alleen voor timer warning states.

**8. Queue**

Een Queue is een geordende lijst van items.

De primaire Program Queue is in veel situaties feitelijk zowel:

- de rundown
- de cue-list
- de agenda
- de bron voor stage timing

Er bestaat daarom geen aparte Agenda-database of apart agenda-object.

Een agenda is gewoon een Board/View die bepaalde beschikbare data
selecteert en presenteert.

Bijvoorbeeld:

Source:  
Event A

Filter:  
Room = Main Stage  
Queue = Program  
Visibility = Public

kan een programma-overzicht opleveren.

Maar een Board mag net zo goed data uit Show B tonen terwijl het fysiek
in Room A staat.

De data moet zo vrij mogelijk bruikbaar zijn.

**9. Parallelle Queues**

Een Show mag meerdere Queues naast elkaar bevatten.

Bijvoorbeeld:

PROGRAM  
10:00 Keynote Jan

STAGE  
09:55 Jan backstage  
09:58 Stand-by Jan  
10:00 GO Jan

AUDIO  
09:58 Check headset  
09:59 Headset LIVE  
10:00 Walk-in fade

LIGHT  
09:59 Stand-by keynote  
10:00 GO keynote look

Deze Queues zijn peers.

Audio is dus niet een subqueue van de keynote en Stage Management is
geen child van de Program Queue.

Daarmee blijft het model vlak en overzichtelijk.

Relaties tussen Queues

Queue Items mogen optioneel gekoppeld worden aan items uit een andere
Queue.

Bijvoorbeeld:

Program:  
Keynote Jan 10:00

Audio:  
Headset LIVE -01:00 relative to Keynote Jan

Wanneer de keynote naar 10:05 wordt verschoven, kan het gekoppelde
Audio-item automatisch naar 10:04 verschuiven.

Deze koppeling kan worden verbroken.

Hierdoor ontstaat synchronisatie tussen disciplines zonder ingewikkelde
parent-childstructuren.

**Live wijzigingen en gekoppelde planning**

Een wijziging aan een actieve timer, bijvoorbeeld +05:00, verandert
direct de actuele timing state van de Show. Of en hoe toekomstige
geplande Queue Items daardoor verschuiven, wordt bepaald door de timing
mode en eventuele operatoractie.

Bij Strict / Operator Controlled blijven de geplande tijden het
referentiepunt en wordt de afwijking zichtbaar als ahead/behind. Bij
Sliding mag de planning meeverschuiven, maar gekoppelde Queues mogen
niet zonder visuele context abrupt over het scherm herschikken.

De interface moet live verschuivingen rustig en voorspelbaar tonen.
Gewijzigde of nog te verwerken items kunnen tijdelijk worden gemarkeerd,
bijvoorbeeld als SHIFT PENDING of UPDATED +05:00. De gebruiker moet
kunnen zien welke gekoppelde items geraakt worden.

Wanneer een planningverschuiving wordt toegepast, behouden relationeel
gekoppelde items standaard hun relatieve offset. De koppeling kan bewust
worden verbroken.

**10. Queue Item**

De Queue Item is de universele bouwsteen van een Queue.

Er komen functioneel geen volledig verschillende objecttypen voor Timer,
Note, Break, Speaker enzovoort.

In plaats daarvan bestaat één basisobject met optionele eigenschappen.

Conceptueel kan een Queue Item bijvoorbeeld bevatten:

Title  
Subtitle  
Description  
Scheduled start  
Scheduled end  
Duration  
Timer  
Speaker / presenter metadata  
Notes  
Tags  
Visibility  
Audience  
Start behaviour  
End behaviour  
Relations  
Actions

Niet ieder item gebruikt al deze eigenschappen.

Presets

Hoewel de onderliggende structuur gelijk blijft, mag de interface wel
presets aanbieden zoals:

Add Timer  
Add Speaker  
Add Note  
Add Break  
Add Cue

Een Speaker is daarmee geen speciaal databaseobject maar een handige
preset voor een Queue Item.

Dit houdt het product eenvoudig terwijl de interface wel betekenisvol
blijft.

**11. Notes**

Notes kunnen op twee manieren voorkomen.

Een Queue Item kan interne notes bevatten:

SPREKER JAN  
Headset 3  
Water op katheder  
PPT vanaf eigen laptop

Daarnaast kan een los Queue Item puur een note zijn:

LET OP:  
CEO ARRIVEERT VIA STAGE LEFT

Net als andere data kan worden bepaald voor welke gebruikers, Boards of
audiences een note zichtbaar is.

Een zendertechnicus hoeft daardoor niet noodzakelijk dezelfde notes te
zien als een Stage Manager.

**12. Groups / Sections**

Een Queue kan Groups bevatten.

Een Group is een echte container en niet alleen een visuele divider.

Bijvoorbeeld:

Ochtendprogramma  
Opening  
Spreker 1  
Spreker 2  
Panel

Middagprogramma  
Opening  
Keynote  
Q&A

Een Group kan worden:

- ingeklapt
- geopend
- versleept
- gedupliceerd
- in zijn geheel naar een andere Queue verplaatst

De child-items verhuizen daarbij mee.

**13. Tags en properties**

Tags worden alleen gebruikt voor vrije classificatie en filtering.

Voorbeelden:

\#keynote  
\#vip  
\#broadcast  
\#sponsor

Functioneel gedrag wordt niet in tags verstopt.

Dus niet:

\#no-screen

maar bijvoorbeeld een echte visibility-instelling:

Speaker Board hidden  
FOH visible  
Stage Manager visible  
Public hidden

Daarmee blijven tags en functionele eigenschappen duidelijk gescheiden.

**14. Timer**

Een Timer is een optionele eigenschap van een Queue Item.

Wanneer een Queue Item een duration/timer heeft wordt het automatisch
een timed item.

Een typische spreker kan bijvoorbeeld zijn:

Spreker Jan  
20:00

De timer ondersteunt minimaal:

- countdown
- count-up/overtime
- start
- pause/resume
- stop
- end/next
- tijd toevoegen
- tijd aftrekken

De interface moet clean maar compleet blijven.

Bijvoorbeeld:

-30 -10 PAUSE +10 +30

met overige showbediening logisch gegroepeerd.

**15. Timer warning states**

Timers ondersteunen visuele fases.

Bijvoorbeeld:

Normal groen  
Warning oranje  
Critical rood  
Overtime rood

Thresholds worden standaard per Show of Queue ingesteld.

Een individueel Queue Item mag deze overrulen.

Thresholds mogen zowel op absolute tijd als percentage gebaseerd kunnen
worden.

Voorbeelden:

Warning at 05:00 remaining  
Critical at 01:00 remaining

of:

Warning at 20%  
Critical at 5%

Overtime kan extra gedrag hebben zoals:

- rood
- knipperen
- eventueel later sneller knipperen
- optionele chime

Knipperen is configureerbaar en nooit verplicht.

**16. Overtime**

Wanneer een countdown nul bereikt kan deze doorlopen:

00:02  
00:01  
00:00  
+00:01  
+00:02  
+00:03

Overtime is geen aparte timer maar een toestand van dezelfde timer.

Wanneer tijdens overtime tijd wordt toegevoegd, wordt de timerwaarde
letterlijk aangepast.

De operator houdt volledige controle.

**17. Meerdere gelijktijdige timers**

Een Show heeft conceptueel één duidelijk Current Queue Item per
relevante operationele context, maar technisch mogen meerdere timers
tegelijk lopen.

Bijvoorbeeld:

CURRENT  
Keynote 18:42

RUNNING TIMERS  
Speaker timer 18:42  
Next speaker call 3:42  
Session elapsed +11:18

Het wisselen van Current hoeft andere timers dus niet automatisch te
stoppen.

**18. Start Modes**

Een Queue Item met timer kan verschillende startwijzen ondersteunen.

Minimaal:

Manual  
Scheduled  
On previous END  
External

De Start Mode wordt per item configureerbaar.

Show/Queue-presets mogen defaults leveren.

Manual  
De operator bepaalt exact wanneer de timer begint.  
Een geplande tijd is hierbij informatief.

Scheduled  
De timer heeft een geplande starttijd.  
Standaard wordt gewerkt met soft scheduled start.

Wanneer bijvoorbeeld om 10:45 een timer zou moeten starten terwijl een
vorige spreker nog actief is, toont het systeem:

SHOULD HAVE STARTED 03:12 AGO

maar start niet zonder operatoringreep.

Ook andere varianten mogen configureerbaar zijn, waaronder een harde
automatische start.

Previous END  
Het item start wanneer een eerder Queue Item met END wordt afgesloten.

External  
Een externe trigger kan dezelfde interne startactie uitvoeren als een
gebruiker.

**19. Stop versus End**

STOP en END zijn verschillende acties.

STOP

STOP betekent:

stop deze timer.

Hierbij worden geen automatisch gekoppelde vervolgacties uitgevoerd.

END / NEXT

END betekent:

dit Queue Item is operationeel afgerond.

Daarna kunnen onder andere plaatsvinden:

mark item complete  
run end actions  
select next item  
optionally start next

Hierdoor kan de operator altijd veilig stoppen zonder onbedoeld de rest
van de show te triggeren.

**20. Timing Modes**

Shows en/of Queues kennen een timingstrategie.

Sliding / Free

Uitloop verschuift het programma.

Bijvoorbeeld:

10:00 Spreker A  
10:20 Spreker B  
10:40 Pauze

A krijgt vijf minuten extra:

10:00 Spreker A  
10:25 Spreker B  
10:45 Pauze

De oorspronkelijke durations blijven intact.

Strict / Operator Controlled

De oorspronkelijke planning blijft het referentiepunt.

Wanneer de show vijf minuten achterloopt toont de applicatie
bijvoorbeeld:

+05:00 BEHIND SCHEDULE

De applicatie verkort geen timers automatisch.

De operator bepaalt waar en hoe tijd wordt teruggewonnen.

Dit is de standaard veiligheidsfilosofie.

Automatic Recovery

Kan later worden toegevoegd.

De software kan dan voorstellen doen of eventueel volgens expliciete
configuratie tijd verdelen over resterende items.

Dit is geen standaard V1-gedrag.

**21. Fixed Time Anchors**

Queue Items kunnen als tijdsanker worden vastgezet.

Bijvoorbeeld:

10:00 Opening  
10:20 Spreker A  
10:40 Spreker B

11:00 Pauze FIXED

11:30 Keynote  
13:00 Lunch FIXED

Het systeem kan aangeven:

+05:18 BEHIND

Next fixed point:  
PAUZE 11:00

Recovery required:  
05:18

De operator bepaalt vervolgens wat ermee gebeurt.

**22. On-time / ahead / behind**

De applicatie houdt continu rekening met geplande en daadwerkelijke
voortgang.

Status kan bijvoorbeeld zijn:

ON TIME  
+03:14 BEHIND  
-01:42 AHEAD

Deze status kan worden gebruikt in:

- Operator View
- Master View
- Event Dashboard
- specifieke Boards

**23. Master View**

De Master View is de uitgebreide beheeromgeving voor een productie.

Master mag zowel plannen als live handelen.

Hier kunnen onder andere:

- Events worden beheerd
- Shows worden verplaatst
- Queues worden aangepast
- Groups en Items worden versleept
- Rooms worden gewijzigd
- items worden gedupliceerd
- locks worden beheerd
- Boards en Devices worden gekoppeld
- timers eventueel direct worden gestart of aangepast

De Master View mag een uitklapbare boomweergave bieden:

Event  
Main Stage  
Main Show  
Program  
Stage  
Audio  
Lighting

Room A  
Workshop Show  
Program

Drag-and-drop is een fundamentele producteigenschap.

**24. Operator View**

De Operator View heeft juist minder mogelijkheden.

De operator moet operaten, niet administreren.

De interface concentreert zich op:

- Current
- Next
- timers
- running timers
- start/pause/stop
- END/NEXT
- tijd aanpassen
- messages
- ahead/behind
- noodzakelijke waarschuwingen

Structurele wijzigingen worden zoveel mogelijk uit deze interface
gehouden.

**25. Locks**

Structuren kunnen worden gelockt om ongewenste wijzigingen tijdens een
productie te voorkomen.

Locks kunnen worden toegepast op bijvoorbeeld:

Event  
Room  
Show  
Queue  
Group  
Queue Item

Afhankelijk van permissions kan een gebruiker een lock negeren of
verwijderen.

Wanneer een gekoppeld Queue Item wordt verplaatst kan de applicatie
bijvoorbeeld vragen:

"Dit item heeft 6 gekoppelde items in andere Queues. Meeverplaatsen?"

Hierdoor blijft flexibiliteit beschikbaar zonder veiligheid op te
offeren.

**Unlock en nood-override**

Een lock mag in een live situatie niet leiden tot een operationele
blokkade wanneer de bevoegde Master tijdelijk niet beschikbaar is.
Daarom ondersteunt het functionele model naast normaal unlocken ook een
Request Unlock-flow en, indien de rol dit toestaat, een Emergency
Override.

Locked by Master  
Request unlock  
Emergency override (permission required)

Een Emergency Override vereist expliciete bevestiging en wordt gelogd
met gebruiker, tijdstip en het object waarop de lock is doorbroken.
Rollen en permissions bepalen wie deze mogelijkheid heeft.

**26. Boards**

Boards zijn de output- en informatielaag van de applicatie.

Een Board is nadrukkelijk niet automatisch een fysiek scherm.

Het is een configuratie die bepaalt:

- welke data wordt gebruikt
- welke data wordt gefilterd
- wat zichtbaar is
- hoe dit wordt weergegeven

Voorbeelden:

Speaker Confidence  
Stage Manager  
FOH  
Backstage  
Room Agenda  
Central Agenda  
Public Signage  
Production Overview  
Custom Board

**27. Board presets en customization**

Boards worden aangeboden met goede presets.

Een gebruiker kan daardoor snel bijvoorbeeld kiezen:

Add Speaker Board

zonder een leeg canvas te hoeven ontwerpen.

Een Board kan vervolgens worden aangepast.

Elementen kunnen bijvoorbeeld zijn:

Timer  
Current title  
Speaker  
Subtitle  
Next item  
Clock  
Message  
Progress bar  
Show offset  
Running timers  
Logo

Voor V1 hoeft nog geen volledig pixelvrij grafisch designsysteem
beschikbaar te zijn.

Een preset-based configuratie moet echter voldoende professioneel
aanpasbaar zijn. Minimaal moeten zichtbare componenten, volgorde of
positie binnen een begrensde layout, typografie en grootte, labels,
logo/achtergrond, timer appearance, progress indicator en data
source/filtering configureerbaar zijn.

Daarmee zijn de V1-presets geen starre ontwerpen, maar veilige en snel
inzetbare basislayouts.

Een geavanceerde vrije Board Designer kan later volgen.

**28. Data source van Boards**

Boards zijn niet hard gekoppeld aan één agenda of Queue.

Een Board kan data halen uit:

- één Show
- één Queue
- één Room
- meerdere Queues
- een Event
- gefilterde subsets hiervan

Daarmee kan bijvoorbeeld een centraal hal-scherm een samengestelde
agenda van drie Rooms tonen.

Of een backstage-scherm alleen informatie uit de Stage Queue.

**29. Audiences / destinations**

Boards kunnen worden gegroepeerd in audiences.

Bijvoorbeeld:

Stage  
Production  
Backstage  
Public  
Broadcast

Een Board kan lid zijn van meerdere audiences.

Data en messages kunnen daarna worden gericht op één of meer audiences
zonder ieder individueel Board te hoeven selecteren.

**30. Messages**

Ad-hoc messages zijn nadrukkelijk verschillend van normale Queue Items.

Een noodbericht zoals:

AFRONDEN

of:

STOP NU

kan direct naar geselecteerde Boards/audiences worden gestuurd.

Een dergelijk bericht kan:

- onmiddellijk verschijnen
- handmatig worden verwijderd
- eventueel automatisch verdwijnen na een ingestelde tijd

Normale geplande tekst die inhoudelijk bij de show hoort wordt gewoon
als Queue Item of Note opgenomen.

**31. Event Dashboard**

Een Event krijgt een centrale overview.

Hier kan bijvoorbeeld worden weergegeven:

MAIN STAGE  
LIVE  
Keynote Jan  
+03:18 BEHIND

ROOM A  
LIVE  
Workshop A  
ON TIME

ROOM B  
NEXT  
Panel  
14:30

Daarnaast kan het Dashboard status tonen van:

- Boards
- Devices
- Shows
- Queues
- actieve timers
- timingafwijkingen
- verbindingen
- waarschuwingen

Het Event Dashboard is daarmee de globale productiemonitor.

**32. Anonymous Shows**

Een gebruiker hoeft geen account aan te maken om te beginnen.

Een nieuwe anonieme Show wordt direct aangemaakt.

De gebruiker krijgt automatisch toegang tot de Show en kan meteen een
Timer/Queue gebruiken.

Een niet-geclaimde Show blijft standaard 7 dagen bestaan.

Daarna mag deze automatisch worden verwijderd.

Een gebruiker kan de Show gedurende die periode aan een account
koppelen.

**Verloopwaarschuwingen en veilige cleanup**

Het verlopen van een Anonymous Show mag nooit als verrassing komen. In
beheerinterfaces zoals Master wordt ruim voor het verlopen duidelijk
getoond hoeveel tijd resteert en wordt een duidelijke Claim Show-actie
aangeboden.

Anonymous Show  
Expires in 1d 18h  
Claim Show

Operationele Boards, zoals een Speaker Board, worden niet verstoord met
administratieve waarschuwingen zolang dit niet noodzakelijk is voor de
productie.

Een Show die actief in gebruik is op het moment dat de bewaartermijn
afloopt, wordt niet midden in de productie verwijderd. Verwijdering
vindt pas plaats via een veilige cleanup nadat de Show niet meer actief
is.

**33. Accounts en Show claiming**

Een account is vooral bedoeld voor gebruikers die:

- Shows vooraf willen voorbereiden
- templates willen bewaren
- Shows later opnieuw willen gebruiken
- meerdere producties beheren
- Devices beheren
- samenwerken met anderen

Een anonieme Show kan later worden geclaimd door een account.

De eenvoudige instap blijft daarmee intact.

**34. Rollen en rechten**

Rollen mogen niet hardcoded in de functionele logica worden ingebakken.

Het systeem wordt gebaseerd op permissions, waarbij rollen bundels van
permissions zijn.

Initiële rollen kunnen zijn:

Owner / Admin  
Master  
Operator  
Viewer

Later kunnen zonder fundamentele wijzigingen rollen worden toegevoegd
zoals:

Stage Manager  
Producer  
Technical Director  
Contributor  
Guest Editor

Board-toegang staat los van gebruikersrechten.

Een Speaker Board heeft bijvoorbeeld geen Operator-account nodig.

**35. Sharing**

Sharing kan zowel centraal als vanaf een individueel Board.

Centraal kan een gebruiker bijvoorbeeld zien:

Speaker Board Share  
Stage Manager Share  
Public Agenda Share  
Operator Invite

Per Board is eveneens direct beschikbaar:

Share  
QR

Share-links kunnen later eigenschappen ondersteunen zoals:

- intrekken
- regenereren
- expiration
- PIN
- read-only toegang

De rechten worden niet uitsluitend bepaald door het leesbare URL-pad
maar door veilige toegangsinformatie.

**36. Devices**

Devices worden als echte objecten beheerd.

Na eerste koppeling krijgt een Device een uniek ID.

Voorbeelden:

Room A Tablet  
Main Stage Confidence  
Foyer Screen 1  
FOH Laptop

Device Management ondersteunt minimaal:

- naam
- uniek ID
- online/offline status
- laatst gezien
- toegewezen Board
- gekoppelde Show/Event
- opnieuw toewijzen
- verwijderen

**37. Device pairing**

Er komen minimaal twee manieren om een Device te koppelen.

Direct link / QR

Geschikt voor tijdelijke outputs.

Gebruiker scant QR of opent een unieke URL.

Device code

Geschikt voor vaste installaties.

Het Device opent bijvoorbeeld de device-pagina en krijgt een korte code:

482 716

In Master selecteert de gebruiker deze code en koppelt het Device
vervolgens aan een Board.

Daarna blijft het Device bekend en kan het later eenvoudig opnieuw
worden toegewezen.

**38. Realtime gedrag**

Alle relevante Views en Boards moeten dezelfde actuele showstatus zien.

Wanneer bijvoorbeeld de Operator een timer start:

Operator  
-\> Show state  
-\> Speaker Board  
-\> Stage Manager  
-\> FOH  
-\> Event Dashboard

moeten de relevante schermen direct worden bijgewerkt.

De Show heeft dus één gedeelde actuele state waarop verschillende
clients zich abonneren.

De technische implementatie hiervan wordt pas in het technische ontwerp
bepaald.

**Offline robuustheid**

Een reeds geopend Board moet een korte netwerkonderbreking kunnen
doorstaan zonder zijn bruikbare output te verliezen. Een lopende timer
blijft op basis van de laatst bekende state lokaal zichtbaar doorlopen;
het Board mag niet vervangen worden door een laadscherm of foutpagina.

Waar relevant wordt een subtiele status zoals OFFLINE / RECONNECTING
getoond. Op publieks- of Speaker Boards is deze melding zo terughoudend
mogelijk; op Operator, Master en monitoring-views moet de
verbindingsstatus duidelijk zichtbaar zijn.

Tijdens een disconnect mag een client geen succesvolle centrale
bediening suggereren wanneer de authoritative Show State niet bereikbaar
is. De interface maakt duidelijk onderscheid tussen lokaal weergegeven
state en acties die centrale bevestiging vereisen.

Na reconnect synchroniseert de client opnieuw met de authoritative Show
State. Eventuele afwijkingen worden gecontroleerd gecorrigeerd, zodat
timers of layouts niet onnodig abrupt verspringen.

**39. Integraties**

De applicatie wordt functioneel voorbereid op integraties.

Belangrijk uitgangspunt:

"Een integratie is niet onderdeel van de Timer-engine zelf."

Externe systemen mogen timers bedienen en door de applicatie aangestuurd
worden, maar een storing in een integratie mag de kernfunctionaliteit
nooit onbruikbaar maken.

**40. Externe besturing**

Integraties moeten uiteindelijk acties kunnen uitvoeren zoals:

Start timer  
Pause timer  
Stop timer  
GO item  
END item  
Next  
Previous  
Set current  
Add time  
Send message

Een externe START gebruikt dezelfde interne functionaliteit als wanneer
de Operator op START drukt.

**41. Actions**

Queue Items kunnen later Actions krijgen.

Deze Actions kunnen reageren op events zoals:

On start  
On pause  
On resume  
On warning  
On critical  
On overtime  
On end  
On manual GO

Per event kunnen meerdere Actions bestaan.

Mogelijke transports zijn later onder andere:

OSC  
HTTP  
Webhook  
Companion  
QLab  
MIDI

**42. Integratiefouten**

Integraties zijn standaard non-blocking.

Wanneer een externe Action mislukt:

- de Show blijft draaien
- de Timer blijft lopen
- de Action krijgt een failed-status
- Operator krijgt een geschikte waarschuwing
- Master kan meer detail bekijken

Retry-mechanismen kunnen later worden toegevoegd.

Een integratie mag alleen blocking gedrag krijgen wanneer dit expliciet
wordt geconfigureerd.

**43. Feedback naar externe systemen**

Integraties zijn uiteindelijk bidirectioneel.

Niet alleen:

Companion -\> START TIMER

maar ook:

Timer started -\> Companion feedback  
Timer warning -\> button state  
Overtime -\> red feedback  
Current changed -\> new label  
Show behind -\> status feedback

Hierdoor kunnen externe bedieningspanelen daadwerkelijk onderdeel worden
van de showworkflow.

**44. Local Agent**

Voor protocollen die vanuit een cloud-webapp niet rechtstreeks
beschikbaar zijn, zoals lokale OSC/UDP, komt later een optionele Local
Agent.

Conceptueel:

Cloud application  
\<-\>  
Local Agent  
\<-\>  
OSC / MIDI / local HTTP / QLab / Companion

De Local Agent kan later als Device-achtig object worden beheerd.

Eigenschappen zijn bijvoorbeeld:

Name  
ID  
Online/offline  
Assigned Event/Show  
Enabled protocols  
Logs

De Local Agent is niet noodzakelijk voor normaal gebruik van het
product.

**45. Admin Portal**

Er komt uiteindelijk een aparte beheeromgeving voor
productadministratie.

Dit is iets anders dan Master binnen een productie.

De Admin Portal is bedoeld voor bijvoorbeeld:

- users
- accounts
- anonymous Shows
- verlopen Shows
- Devices
- systeemstatus
- misbruik
- cleanup
- eventuele abonnementen/licenties
- supportfunctionaliteit

De precieze invulling wordt later ontworpen.

De onderliggende architectuur moet wel vanaf het begin rekening houden
met deze beheerlaag.

**46. MVP / versie 1**

De eerste werkelijk bruikbare versie moet meer zijn dan alleen een
countdown, maar hoeft nog niet alle toekomstige showcontrol-integraties
te bevatten.

Voor V1 beschouwen we voorlopig als kern:

- direct Anonymous New Show
- simpele Quick Timer
- accounts en Show claiming
- Show + Queue
- universele Queue Items
- Timer-property
- Notes
- Groups
- tags en visibility
- parallelle Queues
- relaties tussen Queue Items
- timer warning states
- overtime
- manual/scheduled/previous/external-ready startmodellen
- STOP versus END/NEXT
- meerdere running timers
- Current / Next
- Sliding en Strict timing
- fixed anchors
- ahead/on-time/behind
- Master View
- Operator View
- realtime synchronisatie
- Board presets
- configureerbare Board-content
- audiences
- ad-hoc messages
- QR/share
- basis Device Management
- Event
- optionele Rooms/Areas
- drag-and-drop
- duplication
- locks
- Event Dashboard
- uitbreidbaar rollen- en permissionsmodel
- basis externe API

Niet noodzakelijk voor V1:

- OSC
- Bitfocus Companion integration
- QLab integration
- Local Agent
- MIDI
- advanced action engine
- volledig vrije Board Designer
- automatische schedule recovery
- uitgebreide analytics
- uitgebreide logs/audit
- complexe custom roles
- geavanceerd Admin Portal

De datamodellen en functionele grenzen moeten wel zo ontworpen zijn dat
deze later toegevoegd kunnen worden zonder fundamentele herbouw.

**Wijzigingen in versie 0.2**

Versie 0.2 verwerkt de functionele review op vijf punten: live
verschuivingen van gekoppelde parallelle queues, zichtbaarheid van
instelling-overerving, nood-override van locks, expiry-behandeling van
Anonymous Shows, offline robuustheid en een scherpere eis voor
configureerbare Board presets.

**47. Samengevat productmodel**

Als we alles terugbrengen tot de essentie ontstaat:

EVENT optional  
\|  
+-- ROOM / AREA optional  
\|  
+-- SHOW  
\|  
+-- QUEUE  
\| \|  
\| +-- GROUP  
\| \| +-- QUEUE ITEM  
\| \|  
\| +-- QUEUE ITEM  
\| +-- content  
\| +-- timer  
\| +-- notes  
\| +-- metadata  
\| +-- visibility  
\| +-- timing  
\| +-- relations  
\| +-- actions  
\|  
+-- parallel QUEUES

SHOW STATE  
+-- current  
+-- next  
+-- running timers  
+-- schedule deviation  
+-- messages

-\>

BOARDS  
+-- Speaker  
+-- Stage Manager  
+-- FOH  
+-- Public  
+-- Agenda  
+-- Backstage  
+-- Custom

-\>

DEVICES / USERS / EXTERNAL SYSTEMS

De kern van het product is daarmee:

"Een Queue bevat informatie over wat er gebeurt. De timer is daar één
eigenschap van. De Show bepaalt de actuele state. Boards bepalen wat
mensen daarvan zien."
