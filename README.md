![OIG4 (2)](powerlinker-logo.png)

# Powerlinker (Grafter)
Based off of FamilySearch's Source Linker (a feature allows users to link records and people on the family tree to (1) grow the tree, and (2) connect people on the tree to credible sources such as a census record, etc.) 

The Problem: 
1. Users have to click many times on Source Linker, taking too much time for hints that are easy.
2. Many users don't have a Family Search account (i.e. a youth group, etc.)

The Solution: **Powerlinker**

1. Users can click one button indicating that the hint is a match *(hint = record person + tree person not yet linked but seems like they are the same and should therefore be connected)*
2. Users don't have to be logged in *(Powerlinker includes a feature that makes sure people aren't just clicking through and are correctly doing hints. Else, the user's session and all hints they've voted for are deemed invalid)*
3. Users add a vote to a hint by clicking `Match` (+1 vote). If the hint doesn't seem like a match, the user clicks `Not a Match`(-1 vote) or `Not sure` (0 vote).
4. Once a hint has over 3 positive votes, Dr. Price will connect them (in the future, we want to do this automatically). If a hint has over 3 negative votes, it will be labelled as unlikely to be valid and removed. Otherwise, if a hint is looked over too many times (gets 5 or so `skip` or `not sure` votes), it is deemed more difficult and the hint will be rerouted to other apps where professionals can look at it.

# Where Powerlinker fits in the Vineyard:
![OIG4 (2)](https://raw.githubusercontent.com/byuawsfhtl/tree-growth/main/docs/Misc/Power%20Linker%20Cloud%20Architecture.png?token=GHSAT0AAAAAAC7FJJCPXHKQ7DGJFA7IJX2O2BYRKIA)

# TO DO:
### TTService:
 - It seems like the column selection here could be super broken in the code that I recycled. The issue is that it's done like this across the entirety of the program. Make sure this
is working as expected and fix it to call empty columns (probably) when selected so that the call actually grabs all of them.
### Frontend:
- verify new look works fine
- have a 3 person and 6 person option that you can turn off
### Other:
- implement dummy hints. lambda endpoint? frontend? for now, there is a json file of dummy hints we will use. at some point, we
should turn it into a lambda that just randomly selects from the json file so that later we can implement a more complex 
algorithm
- for now, have a **separate upload** for powerlinker, long-term we can do the GS integration
- we need to store the project with the hint, pl will allow hints from any project

# Frontend
### Getting started:
- Run `npm run dev` to start the application.
### Techstack:
- Application is built using `Vite` & `React` & `Typescript` + `SWC`
### Key Models:
| Name | Details |
| :-------- | -------: |
| Person | id: `string`<br>name: `string`<br>sex: `string`<br>relationship?: `string`<br>events?: `Array<Event>`<br>createNewPerson?: `boolean`|
| Event | name: `string`<br>place?: `string`<br>date?: `string`|
| HintInfo | id?: `string`<br>focusPerson: `Person`<br>persons?: `Array<Person>`|
| Hint | type: `string`<br>recordInfo: `HintInfo`<br>treeData: `HintInfo`|
| FlexibleDate | likelyDay?: `number`<br>likelyMonth?: `string`<br>likelyYear?: `number`|

### Main Components:
| Name | Details |
| :-------- | -------: |
| DocumentMatcher | Displays tree people `HintInfo` and record people `HintInfo` (via mapping the list of each one into a `PotentialMatch` component)|
| PotentialMatch | Displays one tree `Person` and one record `Person`|
| MatchTable | Contains match details and header components of the `PotentialMatch`|
| Collapsible | Contains details of hint, can go up and down|
### Pages:
| Name | Details |
| :-------- | -------: |
| Home | Displays `DocumentMatcher` |
| NotFound | Page not found |
| Upload | Upload hints |
### Custom Packages made by TreeGrowth team:
| Name | Details |
| :-------- | -------: |
| `name-comparator` | Compares names to see how similar they are|
| `getHighlightType` | Returns green, red, or yellow for how similar two dates / strings are|

# Backend
### Techstack: 
- AWS `Lambda`, `DynamoDB`, `Cloudwatch / EventBridge(new name of Cloudwatch)`

| Main functions / Lambdas | Details |
| :----- | :-----: |
| `handleHintList` | Returns `[Hint]` - think of it as the bare bones of a hint (`pid`, `ark`, `recordType`)|
| `handleHintData` | Expands the hints that was retrieved by `handleHintList`. To do this, it calls `Pyfs` functions `getCompleteFamilyInfoForPid` and `getCompleteFamilyInfoForArk` to get name, relationship, events, of pid / ark and immediate family members in the hint. |
| `handleHintComplete` | Attaches the source to people on tree, and adds any new events to the tree people that was found on the record as well. |
| `handleHintVote` | Updates the `votes` on a hint in the `power-linker-auto` table. |
| `handleSessionInvalidate` | Invalidates session of the current user and any votes they had done it that session. |

# Terraform
| Resource name | Details |
| :-------- | -------: |
| ECR Repo |  |
| React lambda | `hint-list`: `GET`<br>`hint-vote`: `POST`<br>`hint-complete`: `POST`<br>`session-invalidate`: `POST`<br> |
| SQS Queue | Vote queue |
| Lambda Event Source Mapping / SQS Lambda Trigger | Get's 10 hints |
| DynamoDB Table | `power_linker_auto` table to get hints |
| DynamoDB Table | `power-linker-invalid-sid` stores invalid user session IDs |
| IAM Policy | |


# Running locally with AWS and TT
The backend can be run via the main.py file in the backend src directory. Simply run the file using python to start it up. If there are issues with finding a module `No module named '<module_name>'`, consider running it instead as a module. You can do this with the -m tag after the python call and changing the path to the directory to be formatted similarly to an import rather than a filepath. Here is an example:

`python -m powerlinker.backend.src.main`

This sometimes fixes that error

***Note:*** The "path" attribute is the path of the lambda you want to call, and the "event" is the event object to forward to that 
lambda. "path" has a default value of "/hint-list" and "event" has different default values for each path (see [handle_test](./backend/awsLambda/views/main.py#L106)).

# Running locally without AWS (mock backend)
If you don't have AWS credentials or access to the private TreeTapper / Boto4GS repos, you can run the frontend against a
local mock of the API in `backend/mock`. It serves the same routes (`GET /hints`, `PUT /hints`, `POST /session-invalidate`)
on port 8000 of the same host the frontend is opened on (`localhost` or `127.0.0.1`).

- Hints come from the sample data in `backend/public/dummy/hints.json` and are kept in memory.
- Votes are applied right away (no SQS) using the same thresholds as `VoteService`. Settled hints leave the pool and are
labelled `ATTACH_ME`, `REJECTED`, or `EXPERT` (sent to other apps).
- Each visitor gets a signed, anonymous `pl_voter` cookie (HttpOnly, 400 days, renewed on every request). Dummy hints are
graded on the server, and each voter's weight is `(correct + 1) / (answered + 2)`, so new voters start at 0.5 and earn
trust. A vote keeps the weight its voter had when it was cast. The +3 / -3 thresholds use weighted votes; the 5-vote and
3-skip limits still count people. One vote per voter per hint. Voters are only recorded once they vote.
- The frontend sends cookies only when running locally, so deployed environments are unchanged.
- Unlike the real backend, the mock doesn't send the dummy hint's answer to the browser. The frontend therefore treats
dummy hints as normal hints and sends their votes to the server for grading, so the client-side strike and session
invalidation logic doesn't run against the mock.
- `GET /mock/state` shows the pool, each hint's votes, settled hints, voters, and invalidated sessions. `POST /mock/reset`
puts every sample hint back.

### Setup (once)
```
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r backend/mock/requirements.txt
```

### Run
From the repo root:
```
.venv/bin/python -m backend.mock.server
```
or from `frontend/`: `npm run mock-backend` (uses `.venv` automatically). Then start the frontend with `npm run dev` and
open http://localhost:5173.

### Tests
```
.venv/bin/python -m pytest backend/tests/mock
```
