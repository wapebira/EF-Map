# worldapi pipeline

Created with [dlt-init-openapi](https://github.com/dlt-hub/dlt-init-openapi) v. 0.1.0

Generated from downloaded spec at `https://world-api-stillness.live.tech.evefrontier.com/docs/doc.json`
## Learn more at

* https://dlthub.com
* https://github.com/dlt-hub/dlt
* https://github.com/dlt-hub/dlt-init-openapi


## Available resources
* _GET /abis/config_ 
  *resource*: get_abisconfig  
  *description*: retrieve the world contracts ABIs with some config
* _GET /config_ 
  *resource*: get_config  
  *description*: retrieve all the config needed to connect to our services
* _GET /v2/fuels_ 
  *resource*: get_v_2_fuels  
* _GET /health_ 
  *resource*: get_health  
  *description*: Tells you if the World API is ok
* _GET /v2/smartcharacters/me/jumps_ 
  *resource*: get_v_2_smartcharactersmejumps  
  *description*: returns all the gate jumps that the current authenticated user made
* _GET /v2/smartcharacters/me/jumps/{id}_ 
  *resource*: get_v_2_smartcharactersmejumpsid  
  *description*: returns a single jump by the given id that the current authenticated user made
* _GET /v2/killmails_ 
  *resource*: get_v_2_killmails  
  *description*: Retrieve all killmails that have been saved to the chain Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/killmails/{id}_ 
  *resource*: get_v_2_killmailsid  
  *description*: returns a single killmail by the given id
* _GET /v2/smartassemblies_ 
  *resource*: get_v_2_smartassemblies  
  *description*: list all the smart assemblies currently in the world Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/smartassemblies/{id}_ 
  *resource*: get_v_2_smartassembliesid  
  *description*: Retrieve one Smart Assembly with the given id if the assembly is a gate then the `.gate{}` will be filled if the assembly is a storage unit then the `.storage{}` object will be filled
* _GET /v2/smartcharacters_ 
  *resource*: get_v_2_smartcharacters  
  *description*: list all the smart characters currently in the world Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/smartcharacters/{address}_ 
  *resource*: get_v_2_smartcharactersaddress  
  *description*: retrieve one smart character with the given address
* _GET /v2/solarsystems_ 
  *resource*: get_v_2_solarsystems  
  *description*: list all the solar systems currently in the game Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/solarsystems/{id}_ 
  *resource*: get_v_2_solarsystemsid  
  *description*: get details about a single solar system
* _GET /v2/tribes_ 
  *resource*: get_v_2_tribes  
  *description*: list all the tribes currently in the game Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/tribes/{id}_ 
  *resource*: get_v_2_tribesid  
  *description*: get details about a single tribe
* _GET /v2/types_ 
  *resource*: get_v_2_types  
  *description*: list all the game types Endpoint is paginated, use the `limit`/`offset` query param to paginate
* _GET /v2/types/{id}_ 
  *resource*: get_v_2_typesid  
  *description*: get details about a single game type

